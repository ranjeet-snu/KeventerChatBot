import { LightningElement, track, wire } from 'lwc';

import startTaskChatSession   from '@salesforce/apex/TaskChatBotController.startTaskChatSession';
import sendTaskChatMessage    from '@salesforce/apex/TaskChatBotController.sendTaskChatMessage';
import updateTaskDescription  from '@salesforce/apex/TaskChatBotController.updateTaskDescription';
import searchTasks            from '@salesforce/apex/TaskChatBotController.searchTasks';
import getTaskAgentMetadata   from '@salesforce/apex/TaskChatBotController.getTaskAgentMetadata';
import getLanguageMapJson     from '@salesforce/apex/TaskChatBotController.getLanguageMapJson';
import generateResponse       from '@salesforce/apex/GeminiController.generateResponse';
import speechRecognizerWrapper from '@salesforce/resourceUrl/speechRecognizerWrapper';  

// ─── Intent keywords the agent response can contain ─────────────────────────
const SEARCH_TRIGGERS  = ['search', 'find', 'look', 'which task', 'show task', 'list task'];
const UPDATE_TRIGGERS  = ['update', 'set description', 'add comment', 'change description', 'write'];
const CONFIRM_TRIGGERS = ['confirm', 'yes', 'proceed', 'go ahead', 'do it', 'ok'];  

export default class TaskChatBot extends LightningElement {
    
    // ── UI state ──────────────────────────────────────────────────────────────
    @track isChatOpen      = false;
    @track isInitializing  = false;
    @track isSending       = false;
    @track isListening     = false;
    @track messages        = [];
    @track userInput       = '';
    @track hasUnread       = false;
    @track unreadCount     = 0;

    // ── Agent / session ───────────────────────────────────────────────────────
    sessionId = null;
    sessionStarted = false;

    // ── Task selection state ──────────────────────────────────────────────────
    @track selectedTask         = null;   // { id, subject }
    @track pendingDescription   = null;   // text the agent wants to write
    @track awaitingConfirmation = false;  // waiting for user to confirm update

    // ── Metadata ──────────────────────────────────────────────────────────────
    @track agentName        = 'Task Assistant';
    @track agentLoadingMsg  = 'Working on it...';
    @track agentJoinedMsg   = 'Task Agent connected.';

    // ── Language / voice ─────────────────────────────────────────────────────
    @track selectedLanguage = 'English (US)';
    @track languageOptions  = [];
    @track languageMap      = {};
    currentlySpeakingMsgId  = null;
    currentUtterance        = null;

    iframeUrl = speechRecognizerWrapper + '/speech.html';

    // ── Wires ─────────────────────────────────────────────────────────────────

    @wire(getTaskAgentMetadata)
    wiredMeta({ data, error }) {
        if (data) {
            this.agentName       = data.Agent_Name__c       || 'Task Assistant';
            this.agentLoadingMsg = data.Agent_Loading_Message__c || 'Working on it...';
            this.agentJoinedMsg  = data.Agent_Joined_Message__c  || 'Task Agent connected.';
        } else if (error) {
            console.error('Metadata error:', error);
        }
    }

    @wire(getLanguageMapJson)
    wiredLang({ data, error }) {
        if (data) {
            try {
                this.languageMap    = JSON.parse(data);
                this.languageOptions = Object.keys(this.languageMap).map(k => ({ label: k, value: k }));
            } catch (e) {
                console.error('Language parse error:', e);
            }
        } else if (error) {
            console.error('Language fetch error:', error);
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    connectedCallback() {
        window.addEventListener('message', this.handleSpeechResult.bind(this));
    }

    disconnectedCallback() {
        window.removeEventListener('message', this.handleSpeechResult.bind(this));
    }

    renderedCallback() {
        this.scrollToBottom();
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    get chatPanelClass() {
        return 'chat-panel' + (this.isChatOpen ? ' chat-panel--open' : '');
    }

    get headerStatusText() {
        if (this.isInitializing) return 'Connecting...';
        if (this.isSending)      return 'Typing...';
        return 'Online';
    }

    get inputPlaceholder() {
        if (this.awaitingConfirmation) return 'Type "yes" to confirm or describe a change...';
        if (this.selectedTask)         return `Describe what to add/update on "${this.selectedTask.subject}"...`;
        return 'Search tasks or describe what you need...';
    }

    get micIcon()        { return this.isListening ? 'utility:unmuted' : 'utility:muted'; }
    get micButtonLabel() { return this.isListening ? 'Stop' : 'Voice input'; }
    get isSendDisabled() { return this.isSending || !this.userInput.trim(); }
    get sendBtnClass()   { return 'send-btn' + (this.isSendDisabled ? '' : ' send-btn--active'); }

    get recognitionLang() {
        return this.languageMap[this.selectedLanguage] || 'en-US';
    }

    // ── Chat open / close ─────────────────────────────────────────────────────

    async toggleChat() {
        this.isChatOpen = !this.isChatOpen;

        if (this.isChatOpen) {
            this.hasUnread  = false;
            this.unreadCount = 0;
            if (!this.sessionStarted) {
                await this.initSession();
            }
        }
    }

    async initSession() {
        this.isInitializing = true;
        this.sessionStarted = true;

        try {
            const result = await startTaskChatSession();
            this.sessionId = result.sessionId;

            const now        = new Date();
            const timeStr    = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            const dateStr    = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

            this.messages = [
                this.makeSystemMsg(`${dateStr} • ${timeStr}`),
                this.makeSystemMsg(this.agentJoinedMsg),
                this.makeBotMsg(result.message)
            ];

        } catch (err) {
            this.sessionStarted = false;
            this.messages = [this.makeBotMsg('⚠️ Could not connect to Task Agent. Please try again.')];
            console.error('Session init error:', err);
        } finally {
            this.isInitializing = false;
        }
    }

    // ── Send message flow ─────────────────────────────────────────────────────

    async handleSend() {
        const text = this.userInput.trim();
        if (!text || this.isSending) return;

        this.pushMessage({ id: Date.now(), text, isUser: true, wrapperClass: 'msg-wrapper' });
        this.userInput = '';
        this.isSending = true;

        try {
            // ── FLOW 1: Awaiting confirmation to update task ──────────────────
            if (this.awaitingConfirmation && this.selectedTask && this.pendingDescription) {
                const isConfirmed = CONFIRM_TRIGGERS.some(t => text.toLowerCase().includes(t));

                if (isConfirmed) {
                    const result = await updateTaskDescription({
                        taskId:      this.selectedTask.id,
                        description: this.pendingDescription
                    });
                    const successMsg = this.makeBotMsg(result);
                    successMsg.isSuccess     = true;
                    successMsg.successDetail = `Description updated on "${this.selectedTask.subject}"`;
                    this.pushMessage(successMsg);

                    // Reset state
                    this.selectedTask         = null;
                    this.pendingDescription   = null;
                    this.awaitingConfirmation = false;
                } else {
                    // User changed their mind — treat new text as new description
                    this.pendingDescription = text;
                    await this.askAgentAndDisplay(
                        `The user wants to use this instead: "${text}". Should I update the task description with this? Please confirm.`
                    );
                }
                return;
            }

            // ── FLOW 2: Task selected, user provides description ──────────────
            if (this.selectedTask && !this.awaitingConfirmation) {
                this.pendingDescription   = text;
                this.awaitingConfirmation = true;

                const confirmPrompt = `I want to update task "${this.selectedTask.subject}" with this description: "${text}". Please confirm this update.`;
                await this.askAgentAndDisplay(confirmPrompt);
                return;
            }

            // ── FLOW 3: Normal message — pass to agent, detect intent ─────────
            await this.askAgentAndDisplay(text);

        } catch (err) {
            this.pushMessage(this.makeBotMsg('⚠️ Something went wrong. ' + (err?.body?.message || err?.message || '')));
            console.error('Send error:', err);
        } finally {
            this.isSending = false;
        }
    }

    /**
     * Sends text to agent, translates if needed, parses intent, renders result.
     */
    async askAgentAndDisplay(userText) {
        try {
            const rawResponse = await sendTaskChatMessage({
                sessionId: this.sessionId,
                message:   userText
            });

            // Detect if agent wants to search for tasks
            const lowerResponse = rawResponse.toLowerCase();
            const wantsSearch   = SEARCH_TRIGGERS.some(t => lowerResponse.includes(t));

            // Detect if agent extracted a description to write
            const updateMatch = rawResponse.match(/description[:\s]+"?(.+?)"?\s*(?:\.|$)/im);

            // Translate
            let displayText = rawResponse;
            try {
                const translated = await generateResponse({
                    prompt:        rawResponse,
                    inputLanguage: this.recognitionLang || 'en-US'
                });
                displayText = translated
                    ?.replace(/Okay, I will translate.*?(version:)?/i, '')
                    ?.trim() || rawResponse;
            } catch (transErr) {
                console.warn('Translation skipped:', transErr);
            }

            const botMsg = this.makeBotMsg(displayText);

            // ── Auto-search if agent implies finding tasks ────────────────────
            if (wantsSearch) {
                const keyword = this.extractSearchKeyword(userText);
                const taskJson = await searchTasks({ keyword });
                const tasks    = JSON.parse(taskJson);

                if (tasks.length > 0) {
                    botMsg.taskCards = tasks.map(t => ({
                        id:                 t.id,
                        subject:            t.subject,
                        status:             t.status,
                        priority:           t.priority,
                        description:        t.description,
                        descriptionPreview: t.description ? t.description.substring(0, 80) + (t.description.length > 80 ? '…' : '') : '',
                        cardClass:          'task-card',
                        statusClass:        'task-badge task-badge--status',
                        priorityClass:      'task-badge task-badge--priority'
                    }));
                } else {
                    botMsg.text += '\n\nNo open tasks found matching your search.';
                }
            }

            // ── If agent extracted a description value ────────────────────────
            if (updateMatch && updateMatch[1] && this.selectedTask) {
                this.pendingDescription   = updateMatch[1].trim();
                this.awaitingConfirmation = true;
            }

            this.pushMessage(botMsg);

        } catch (err) {
            this.pushMessage(this.makeBotMsg('⚠️ Agent error: ' + (err?.body?.message || '')));
            throw err;
        }
    }

    // ── Task card selection ───────────────────────────────────────────────────

    handleTaskSelect(event) {
        const taskId      = event.currentTarget.dataset.taskid;
        const taskSubject = event.currentTarget.dataset.subject;

        this.selectedTask         = { id: taskId, subject: taskSubject };
        this.awaitingConfirmation = false;
        this.pendingDescription   = null;

        this.pushMessage(this.makeBotMsg(
            `Got it! You've selected "${taskSubject}". What description or comment would you like to add or update on this task?`
        ));
    }

    clearSelectedTask() {
        this.selectedTask         = null;
        this.pendingDescription   = null;
        this.awaitingConfirmation = false;
        this.pushMessage(this.makeBotMsg('Task deselected. Tell me which task you want to work on.'));
    }

    // ── Input / keyboard ─────────────────────────────────────────────────────

    handleInput(event) {
        this.userInput = event.target.value;
    }

    handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.handleSend();
        }
    }

    handleLanguageChange(event) {
        this.selectedLanguage = event.detail.value;
    }

    // ── Voice input ───────────────────────────────────────────────────────────

    toggleMic() {
        const iframe = this.template.querySelector('iframe');
        if (iframe?.contentWindow) {
            this.isListening = !this.isListening;
            iframe.contentWindow.postMessage({ command: 'setLang', lang: this.recognitionLang }, '*');
            iframe.contentWindow.postMessage({ command: 'toggle' }, '*');
        }
    }

    handleSpeechResult(event) {
        const data = event.data;
        if (typeof data === 'object' && data.transcript) {
            this.userInput   = data.transcript;
            this.isListening = false;
            this.handleSend();
        } else if (typeof data === 'object' && data.error) {
            this.isListening = false;
            console.error('Speech error:', data.error);
        }
    }

    // ── Voice output (TTS) ────────────────────────────────────────────────────

    handleToggleVoice(event) {
        const msgId   = event.currentTarget.dataset.msgid;
        const msgText = event.currentTarget.dataset.msgtext;

        if (this.currentlySpeakingMsgId && this.currentlySpeakingMsgId !== msgId) {
            speechSynthesis.cancel();
            this.updateVoiceState(this.currentlySpeakingMsgId, false);
        }

        if (this.currentlySpeakingMsgId === msgId && speechSynthesis.speaking) {
            speechSynthesis.cancel();
            this.updateVoiceState(msgId, false);
            this.currentlySpeakingMsgId = null;
            return;
        }

        const utterance     = new SpeechSynthesisUtterance(msgText);
        utterance.lang      = this.recognitionLang;
        utterance.rate      = 1;
        utterance.onend     = () => {
            this.updateVoiceState(msgId, false);
            this.currentlySpeakingMsgId = null;
        };

        this.currentUtterance       = utterance;
        this.currentlySpeakingMsgId = msgId;
        this.updateVoiceState(msgId, true);
        speechSynthesis.speak(utterance);
    }

    updateVoiceState(msgId, isSpeaking) {
        this.messages = this.messages.map(m => ({
            ...m,
            isSpeaking: m.id.toString() === msgId ? isSpeaking : false,
            iconName:   m.id.toString() === msgId
                ? (isSpeaking ? 'utility:pause' : 'utility:play')
                : 'utility:play'
        }));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    makeSystemMsg(text) {
        return { id: this.newId(), text, isSystem: true, wrapperClass: 'msg-wrapper' };
    }

    makeBotMsg(text) {
        return {
            id:          this.newId(),
            text,
            isBot:       true,
            iconName:    'utility:play',
            wrapperClass:'msg-wrapper',
            taskCards:   null,
            isSuccess:   false,
            successDetail: ''
        };
    }

    newId() { return Date.now() + Math.random(); }

    pushMessage(msg) {
        this.messages = [...this.messages, msg];
        if (!this.isChatOpen) {
            this.hasUnread = true;
            this.unreadCount++;
        }
    }

    scrollToBottom() {
        const body = this.template.querySelector('.chat-body');
        if (body) body.scrollTop = body.scrollHeight;
    }

    extractSearchKeyword(text) {
        // Strip common filler words to get the search keyword
        return text
            .replace(/find|search|look for|show me|list|tasks?|about|related to/gi, '')
            .trim();
    }
}
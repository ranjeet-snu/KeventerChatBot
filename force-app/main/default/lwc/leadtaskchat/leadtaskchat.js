import { LightningElement, api, track, wire } from 'lwc';
import getLeadInfo         from '@salesforce/apex/LeadTaskChatController.getLeadInfo';
import getLatestOpenTask   from '@salesforce/apex/LeadTaskChatController.getLatestOpenTask';
import processMessage      from '@salesforce/apex/LeadTaskChatController.processMessage';
import updateTaskComment   from '@salesforce/apex/LeadTaskChatController.updateTaskComment';
//import speechRecognizerWrapper from '@salesforce/resourceUrl/speechRecognizerWrapper';

// ── Language definitions ──────────────────────────────────────────────────────
const LANGUAGES = [
    { code: 'en-US', label: 'English', short: 'EN' },
    { code: 'hi-IN', label: 'Hindi',   short: 'HI' },
    { code: 'bn-IN', label: 'Bengali', short: 'BN' }
];

// ── Conversation FSM states ───────────────────────────────────────────────────
const STATE_IDLE             = 'IDLE';
const STATE_AWAITING_COMMENT = 'AWAITING_COMMENT';
const STATE_CONFIRMING       = 'CONFIRMING';

export default class LeadTaskChat extends LightningElement {

    @api recordId; // Lead record ID injected by Salesforce

    // ── UI toggles ────────────────────────────────────────────────────────────
    @track isOpen        = false;
    @track isLoading     = false;
    @track isTyping      = false;
    @track isListening   = false;
    @track hasNewMessage = false;

    // ── Chat data ─────────────────────────────────────────────────────────────
    @track messages          = [];
    @track userInput         = '';
    @track currentTask       = null; // { taskId, subject, status, priority, dueDate }
    @track conversationState = STATE_IDLE;
    @track pendingComment    = '';

    // ── Lead context ──────────────────────────────────────────────────────────
    @track leadName    = '';
    @track leadCompany = '';

    // ── Language ──────────────────────────────────────────────────────────────
    @track selectedLang     = 'en-US';
    @track activeLangLabel  = 'English';

    // ── Internal ──────────────────────────────────────────────────────────────
    _msgIdCounter  = 0;
    _speechBound   = null;

    iframeUrl = speechRecognizerWrapper + '/speech.html';

    // ─────────────────────────────────────────────────────────────────────────
    // GETTERS
    // ─────────────────────────────────────────────────────────────────────────

    get rootClass() {
        return 'root' + (this.isOpen ? ' root--open' : '');
    }

    get languageOptions() {
        return LANGUAGES.map(l => ({
            ...l,
            pillClass: 'lang-pill' + (this.selectedLang === l.code ? ' lang-pill--active' : '')
        }));
    }

    get inputPlaceholder() {
        if (this.conversationState === STATE_AWAITING_COMMENT) {
            return 'Type or speak your comment...';
        }
        if (this.conversationState === STATE_CONFIRMING) {
            return 'Type YES to confirm or NO to cancel...';
        }
        return 'Ask me anything · "show task" · "update comment"';
    }

    get inputDisabled() {
        return this.isTyping || this.isListening;
    }

    get sendDisabled() {
        return !this.userInput.trim() || this.isTyping || this.isListening;
    }

    get micBtnClass() {
        return 'mic-btn' + (this.isListening ? ' mic-btn--active' : '');
    }

    get sendBtnClass() {
        return 'send-btn' + (!this.sendDisabled ? ' send-btn--ready' : '');
    }

    get micTitle() {
        return this.isListening ? 'Listening...' : `Voice input (${this.activeLangLabel})`;
    }

    get conversationStateLabel() {
        if (this.conversationState === STATE_AWAITING_COMMENT) return 'Adding comment';
        if (this.conversationState === STATE_CONFIRMING)       return 'Confirm?';
        return 'Active';
    }

    get taskBarStateBadge() {
        if (this.conversationState === STATE_CONFIRMING)       return 'state-badge state-badge--warn';
        if (this.conversationState === STATE_AWAITING_COMMENT) return 'state-badge state-badge--info';
        return 'state-badge state-badge--ok';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────────

    connectedCallback() {
        this._speechBound = this._onSpeechMessage.bind(this);
        window.addEventListener('message', this._speechBound);
    }

    disconnectedCallback() {
        window.removeEventListener('message', this._speechBound);
    }

    renderedCallback() {
        this._scrollToBottom();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OPEN / CLOSE
    // ─────────────────────────────────────────────────────────────────────────

    async openChat() {
        this.isOpen        = true;
        this.hasNewMessage = false;

        if (this.messages.length === 0) {
            await this._initChat();
        }
    }

    closeChat() {
        this.isOpen = false;
        if (this.isListening) this._stopMic();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INIT
    // ─────────────────────────────────────────────────────────────────────────

    async _initChat() {
        this.isLoading = true;
        try {
            // Load lead info
            const leadInfo = await getLeadInfo({ leadId: this.recordId });
            this.leadName    = leadInfo.name;
            this.leadCompany = leadInfo.company;

            // Load latest open task
            const taskInfo = await getLatestOpenTask({ leadId: this.recordId });

            const now     = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

            this._addSystem(`${dateStr} · ${timeStr}`);
            this._addSystem(`Connected · Lead: ${this.leadName} · ${this.leadCompany}`);

            if (taskInfo.found === 'true') {
                this.currentTask = {
                    taskId:             taskInfo.taskId,
                    subject:            taskInfo.subject,
                    status:             taskInfo.status,
                    priority:           taskInfo.priority,
                    dueDate:            taskInfo.dueDate,
                    currentDescription: taskInfo.currentDescription
                };

                const welcomeMsg = this._makeBotMsg(
                    `Hello! 👋 I found the latest open task for ${this.leadName}.`
                );
                welcomeMsg.showTaskCard = true;
                welcomeMsg.taskCard = {
                    subject:            taskInfo.subject,
                    status:             taskInfo.status,
                    priority:           taskInfo.priority,
                    dueDate:            taskInfo.dueDate,
                    currentDescription: taskInfo.currentDescription,
                    hasDescription:     !!taskInfo.currentDescription,
                    statusClass:        this._statusClass(taskInfo.status),
                    priorityClass:      this._priorityClass(taskInfo.priority)
                };
                this._push(welcomeMsg);

                this._addBot(
                    `You can:\n• "Update comment: [your note]"\n• Tap the 🎙️ mic and speak in English, हिंदी, or বাংলা\n• "Show task" to refresh task info`
                );
            } else {
                this._addBot(
                    `Hello! 👋 No open tasks found for ${this.leadName} yet.\n\nPlease create a task from the Activity panel, then come back here to add comments.`
                );
            }

        } catch (err) {
            this._addBot('⚠️ Could not load Lead data. Please refresh and try again.');
            console.error('Init error:', err);
        } finally {
            this.isLoading = false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SEND
    // ─────────────────────────────────────────────────────────────────────────

    handleInput(event) {
        this.userInput = event.target.value;
    }

    handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.handleSend();
        }
    }

    async handleSend(isVoice = false) {
        const text = this.userInput.trim();
        if (!text || this.isTyping) return;

        // Add user bubble
        const userMsg = this._makeUserMsg(text, isVoice);
        this._push(userMsg);
        this.userInput = '';
        this.isTyping  = true;

        try {
            const taskId = this.currentTask ? this.currentTask.taskId : null;

            const result = await processMessage({
                leadId:            this.recordId,
                taskId:            taskId,
                userMessage:       text,
                conversationState: this.conversationState,
                pendingComment:    this.pendingComment
            });

            // Update state machine
            this.conversationState = result.newState || STATE_IDLE;
            this.pendingComment    = result.pendingComment || '';

            // Update task reference if returned
            if (result.taskId && !this.currentTask) {
                this.currentTask = {
                    taskId:   result.taskId,
                    subject:  result.taskSubject || 'Task',
                    status:   '—',
                    priority: '—',
                    dueDate:  '—'
                };
            }

            // Build bot message
            const botMsg = this._makeBotMsg(result.botMessage || '');

            if (result.updateDone) {
                botMsg.isSuccess = true;
                this.conversationState = STATE_IDLE;
                this.pendingComment    = '';
            }

            // Show confirm buttons if now confirming
            if (this.conversationState === STATE_CONFIRMING) {
                botMsg.showConfirm = true;
            }

            this._push(botMsg);

        } catch (err) {
            this._addBot('⚠️ Something went wrong: ' + (err?.body?.message || err?.message || ''));
            console.error('Send error:', err);
        } finally {
            this.isTyping = false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // QUICK CONFIRM / CANCEL BUTTONS
    // ─────────────────────────────────────────────────────────────────────────

    async handleConfirmYes() {
        this.userInput = 'yes';
        await this.handleSend(false);
    }

    async handleConfirmNo() {
        this.userInput = 'no';
        await this.handleSend(false);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LANGUAGE
    // ─────────────────────────────────────────────────────────────────────────

    handleLangSelect(event) {
        const code  = event.currentTarget.dataset.code;
        const label = event.currentTarget.dataset.label;
        this.selectedLang    = code;
        this.activeLangLabel = label;

        // Update iframe language immediately
        this._postToIframe({ command: 'setLang', lang: code });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MIC / SPEECH
    // ─────────────────────────────────────────────────────────────────────────

    toggleMic() {
        if (this.isListening) {
            this._stopMic();
        } else {
            this._startMic();
        }
    }

    stopListening() {
        this._stopMic();
    }

    _startMic() {
        this._postToIframe({ command: 'setLang', lang: this.selectedLang });
        this._postToIframe({ command: 'toggle' });
        this.isListening = true;
    }

    _stopMic() {
        this._postToIframe({ command: 'toggle' });
        this.isListening = false;
    }

    _postToIframe(payload) {
        const iframe = this.template.querySelector('iframe');
        if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(payload, '*');
        }
    }

    _onSpeechMessage(event) {
        const data = event.data;
        if (typeof data !== 'object') return;

        if (data.transcript) {
            this.isListening = false;
            this.userInput   = data.transcript;
            this.handleSend(true);
        } else if (data.error) {
            this.isListening = false;
            this._addBot(`🎙️ Microphone error: ${data.error}. Please allow microphone access and try again.`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MESSAGE HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    _newId() {
        this._msgIdCounter++;
        return `msg_${Date.now()}_${this._msgIdCounter}`;
    }

    _makeBotMsg(text) {
        return {
            id:           this._newId(),
            text:         text,
            isBot:        true,
            isUser:       false,
            isSystem:     false,
            isSuccess:    false,
            isVoice:      false,
            showTaskCard: false,
            showConfirm:  false,
            taskCard:     null,
            rowClass:     'msg-row'
        };
    }

    _makeUserMsg(text, isVoice = false) {
        return {
            id:           this._newId(),
            text:         text,
            isBot:        false,
            isUser:       true,
            isSystem:     false,
            isSuccess:    false,
            isVoice:      isVoice,
            showTaskCard: false,
            showConfirm:  false,
            taskCard:     null,
            rowClass:     'msg-row'
        };
    }

    _makeSystemMsg(text) {
        return {
            id:           this._newId(),
            text:         text,
            isBot:        false,
            isUser:       false,
            isSystem:     true,
            isSuccess:    false,
            isVoice:      false,
            showTaskCard: false,
            showConfirm:  false,
            taskCard:     null,
            rowClass:     'msg-row'
        };
    }

    _addBot(text)    { this._push(this._makeBotMsg(text));    }
    _addSystem(text) { this._push(this._makeSystemMsg(text)); }

    _push(msg) {
        this.messages = [...this.messages, msg];
        if (!this.isOpen) {
            this.hasNewMessage = true;
        }
    }

    _scrollToBottom() {
        const area = this.template.querySelector('.messages-area');
        if (area) area.scrollTop = area.scrollHeight;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CSS CLASS HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    _statusClass(status) {
        if (!status) return 'tdc-badge';
        const s = status.toLowerCase();
        if (s.includes('complet') || s.includes('done')) return 'tdc-badge tdc-badge--green';
        if (s.includes('progress'))                       return 'tdc-badge tdc-badge--blue';
        return 'tdc-badge tdc-badge--grey';
    }

    _priorityClass(priority) {
        if (!priority) return 'tdc-badge';
        const p = priority.toLowerCase();
        if (p === 'high')   return 'tdc-badge tdc-badge--red';
        if (p === 'normal') return 'tdc-badge tdc-badge--blue';
        return 'tdc-badge tdc-badge--grey';
    }
}
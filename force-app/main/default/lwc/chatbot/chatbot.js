import { LightningElement, api, track } from 'lwc';
import getLatestOpenTask from '@salesforce/apex/LeadChatBotController2.getLatestOpenTask';
import updateLatestTask from '@salesforce/apex/LeadChatBotController2.updateLatestTask';
import createTask from '@salesforce/apex/LeadChatBotController2.createTask';
import processWithPrompt from '@salesforce/apex/LeadChatBotController2.processWithPrompt';

export default class Chatbot extends LightningElement {
    @api recordId;
    @track isOpen = false;
    @track messages = [];
    @track userInput = '';
    @track isListening = false;
    @track isProcessing = false;
    @track isTyping = false;
    @track selectedLang = 'en-US';
    @track isInputDisabled = true;

    // Conversation state
    // 'idle' | 'awaitingChoice' | 'awaitingComment' | 'awaitingTaskInput'
    @track conversationState = 'idle';
    @track latestTask = null;
    @track msgIdCounter = 0;

    // ── Computed ─────────────────────────────────────────────
    get chatIconClass()    { return this.isOpen ? 'chat-bubble hidden' : 'chat-bubble visible'; }
    get micClass()         { return this.isListening ? 'mic-btn listening' : 'mic-btn'; }
    get micVariant()       { return this.isListening ? 'error' : 'inverse'; }
    get inputWrapperClass(){ return this.isInputDisabled ? 'input-wrapper disabled-bg' : 'input-wrapper'; }
    get placeholderText()  {
        if (this.isProcessing) return 'Processing...';
        if (this.conversationState === 'awaitingTaskInput') return 'Describe your task in one sentence...';
        if (this.conversationState === 'awaitingComment')   return 'Type your comment...';
        return 'Type a message...';
    }

    get engChipClass() { return this.selectedLang === 'en-US' ? 'lang-chip active' : 'lang-chip'; }
    get hinChipClass() { return this.selectedLang === 'hi-IN' ? 'lang-chip active' : 'lang-chip'; }
    get benChipClass() { return this.selectedLang === 'bn-IN' ? 'lang-chip active' : 'lang-chip'; }

    // ── Language ─────────────────────────────────────────────
    setEnglish() { this.selectedLang = 'en-US'; }
    setHindi()   { this.selectedLang = 'hi-IN'; }
    setBengali() { this.selectedLang = 'bn-IN'; }

    // ── Open / Close ─────────────────────────────────────────
    async toggleChat() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.messages = [];
            this.conversationState = 'idle';
            await this.fetchTask();
            this.startGreeting();
        }
    }

    async fetchTask() {
        try {
            this.latestTask = await getLatestOpenTask({ leadId: this.recordId });
        } catch(e) {
            this.latestTask = null;
        }
    }

    // ── Greeting Flow ────────────────────────────────────────
    startGreeting() {
        this.addBotMessage('👋 Hi! I\'m your Task Assistant.', false);

        setTimeout(() => {
            if (this.latestTask) {
                this.showTyping(() => {
                    this.addBotMessage(
                        `I found your open task: "${this.latestTask.Subject}"`,
                        false,
                        null,
                        this.buildTaskUrl(this.latestTask.Id)
                    );
                    setTimeout(() => {
                        this.showTyping(() => {
                            this.addBotMessage(
                                'What would you like to do?',
                                true,
                                [
                                    { label: '💬 Add Comment', value: 'addComment' },
                                    { label: '➕ Create New Task', value: 'createTask' }
                                ]
                            );
                            this.conversationState = 'awaitingChoice';
                        });
                    }, 800);
                });
            } else {
                this.showTyping(() => {
                    this.addBotMessage(
                        'No open task found. Would you like to create one?',
                        true,
                        [{ label: '➕ Create New Task', value: 'createTask' }]
                    );
                    this.conversationState = 'awaitingChoice';
                });
            }
        }, 600);
    }

    // ── Quick Reply Handler ───────────────────────────────────
    handleQuickReply(event) {
        const value = event.currentTarget.dataset.value;
        this.addUserMessage(event.currentTarget.textContent.trim());
        this.disableAllOptions();

        if (value === 'addComment') {
            this.showTyping(() => {
                this.addBotMessage(
                    'Sure! Go ahead and type or speak your comment. You can use Bengali, Hindi, or English — I\'ll handle the rest. 😊'
                );
                this.conversationState = 'awaitingComment';
                this.isInputDisabled = false;
            });
        } else if (value === 'createTask') {
            this.showTyping(() => {
                this.addBotMessage(
                    'Got it! Just describe what the task is about in one sentence. I\'ll auto-create the subject and comment from it. 🚀'
                );
                this.conversationState = 'awaitingTaskInput';
                this.isInputDisabled = false;
            });
        } else if (value === 'yes') {
            this.startGreeting();
        } else if (value === 'no') {
            this.addBotMessage('Okay, have a great day! 👋');
            this.isInputDisabled = true;
        }
    }

    // ── Send Message ─────────────────────────────────────────
    handleSend() {
        const text = this.userInput.trim();
        if (!text) return;
        this.addUserMessage(text);
        this.userInput = '';
        this.isInputDisabled = true;

        if (this.conversationState === 'awaitingComment') {
            this.handleSaveComment(text);
        } else if (this.conversationState === 'awaitingTaskInput') {
            this.handleCreateTaskFromInput(text);
        }
    }

    handleKeyDown(event) {
        if (event.key === 'Enter') this.handleSend();
    }

    // ── Save Comment Flow ────────────────────────────────────
    handleSaveComment(text) {
        this.isProcessing = true;
        this.showTyping(() => {
            this.addBotMessage('Processing your comment... ⚙️');

            updateLatestTask({ taskId: this.latestTask.Id, comment: text })
                .then(() => {
                    this.isProcessing = false;
                    this.showTyping(() => {
                        this.addBotMessage(
                            `✅ Done! Your comment has been saved to the task "${this.latestTask.Subject}".`,
                            false,
                            null,
                            this.buildTaskUrl(this.latestTask.Id)
                        );
                        this.askAnythingElse();
                    });
                })
                .catch(() => {
                    this.isProcessing = false;
                    this.showTyping(() => {
                        this.addBotMessage('❌ Sorry, something went wrong. Please try again.');
                        this.isInputDisabled = false;
                    });
                });
        });
    }

    // ── Create Task Flow ─────────────────────────────────────
    handleCreateTaskFromInput(text) {
        this.isProcessing = true;
        this.showTyping(() => {
            this.addBotMessage('Analyzing your input and creating the task... ⚙️');

            // First send to prompt to get summarized English
            processWithPrompt({ inputText: text })
                .then(summarized => {
                    // Use summarized text as both subject and comment
                    // Subject = first 80 chars of summarized, Comment = full summarized
                    const subject = summarized.length > 80
                        ? summarized.substring(0, 80).trim() + '...'
                        : summarized.trim();

                    return createTask({
                        leadId:  this.recordId,
                        subject: subject,
                        comment: summarized
                    });
                })
                .then(newTask => {
                    this.isProcessing = false;
                    this.latestTask = newTask;
                    this.showTyping(() => {
                        this.addBotMessage(
                            `✅ Task created successfully! Subject and comment were auto-generated from your input.`,
                            false,
                            null,
                            this.buildTaskUrl(newTask.Id)
                        );
                        this.askAnythingElse();
                    });
                })
                .catch(() => {
                    this.isProcessing = false;
                    this.showTyping(() => {
                        this.addBotMessage('❌ Sorry, failed to create the task. Please try again.');
                        this.isInputDisabled = false;
                    });
                });
        });
    }

    // ── Ask Anything Else ────────────────────────────────────
    askAnythingElse() {
        setTimeout(() => {
            this.showTyping(() => {
                this.addBotMessage(
                    'Is there anything else I can help you with?',
                    true,
                    [
                        { label: '✅ Yes', value: 'yes' },
                        { label: '👋 No, thanks', value: 'no' }
                    ]
                );
                this.conversationState = 'awaitingChoice';
            });
        }, 600);
    }

    // ── Message Helpers ───────────────────────────────────────
    addBotMessage(text, hasOptions = false, options = null, taskLink = null) {
        this.messages = [...this.messages, {
            id:         ++this.msgIdCounter,
            text:       text,
            isBot:      true,
            wrapClass:  'msg-wrap bot-wrap',
            bubbleClass:'bubble bot-bubble',
            hasOptions: hasOptions,
            options:    options || [],
            taskLink:   taskLink
        }];
        this.scrollToBottom();
    }

    addUserMessage(text) {
        this.messages = [...this.messages, {
            id:         ++this.msgIdCounter,
            text:       text,
            isBot:      false,
            wrapClass:  'msg-wrap user-wrap',
            bubbleClass:'bubble user-bubble',
            hasOptions: false,
            options:    [],
            taskLink:   null
        }];
        this.scrollToBottom();
    }

    disableAllOptions() {
        this.messages = this.messages.map(m => ({ ...m, hasOptions: false, options: [] }));
    }

    showTyping(callback) {
        this.isTyping = true;
        this.scrollToBottom();
        setTimeout(() => {
            this.isTyping = false;
            callback();
        }, 900);
    }

    scrollToBottom() {
        setTimeout(() => {
            const container = this.template.querySelector('.chat-messages');
            if (container) container.scrollTop = container.scrollHeight;
        }, 50);
    }

    buildTaskUrl(taskId) {
        return '/' + taskId;
    }

    // ── Speech Recognition ───────────────────────────────────
    handleListen() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.addBotMessage('❌ Your browser does not support speech recognition.');
            return;
        }
        const recognition = new SpeechRecognition();
        recognition.lang = this.selectedLang;
        recognition.interimResults = false;
        this.isListening = true;
        recognition.start();
        recognition.onresult   = (e) => { this.userInput = e.results[0][0].transcript; this.isListening = false; };
        recognition.onerror    = () => { this.isListening = false; };
        recognition.onspeechend = () => { recognition.stop(); this.isListening = false; };
    }

    handleInputChange(event) { this.userInput = event.target.value; }
}
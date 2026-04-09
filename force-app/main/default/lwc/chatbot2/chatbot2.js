import { LightningElement, api, track } from 'lwc';
import getLatestOpenTask from '@salesforce/apex/LeadChatBotController2.getLatestOpenTask';
import updateLatestTask from '@salesforce/apex/LeadChatBotController2.updateLatestTask';
import createTask from '@salesforce/apex/LeadChatBotController2.createTask';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class Chatbot extends LightningElement {
    @api recordId;
    @track isOpen = false;
    @track userInput = '';
    @track latestTask;
    @track isListening = false;
    @track isProcessing = false;
    @track selectedLang = 'en-US';

    // View state: 'home' | 'addComment' | 'createTask'
    @track currentView = 'home';

    // Create task form fields
    @track newTaskSubject = '';
    @track newTaskComment = '';

    // ── Computed Properties ──────────────────────────────────
    get isDisabled() { return this.isProcessing; }

    get placeholderText() {
        if (this.isProcessing) return "Processing...";
        return "Type or use mic...";
    }

    get inputWrapperClass() {
        return this.isDisabled ? 'input-wrapper disabled-bg' : 'input-wrapper';
    }

    get chatIconClass() { return this.isOpen ? 'chat-bubble hidden' : 'chat-bubble visible pulse'; }
    get micClass() { return this.isListening ? 'mic-btn listening' : 'mic-btn'; }
    get micVariant() { return this.isListening ? 'error' : 'default'; }

    // View toggles
    get isHomeView()       { return this.currentView === 'home'; }
    get isAddCommentView() { return this.currentView === 'addComment'; }
    get isCreateTaskView() { return this.currentView === 'createTask'; }

    // Language Chip Classes
    get engChipClass() { return this.selectedLang === 'en-US' ? 'lang-chip active' : 'lang-chip'; }
    get hinChipClass() { return this.selectedLang === 'hi-IN' ? 'lang-chip active' : 'lang-chip'; }
    get benChipClass() { return this.selectedLang === 'bn-IN' ? 'lang-chip active' : 'lang-chip'; }

    // ── Language Switchers ───────────────────────────────────
    setEnglish() { this.selectedLang = 'en-US'; }
    setHindi()   { this.selectedLang = 'hi-IN'; }
    setBengali() { this.selectedLang = 'bn-IN'; }

    // ── Toggle Chat ──────────────────────────────────────────
    async toggleChat() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.currentView = 'home';
            this.fetchTask();
        }
    }

    fetchTask() {
        getLatestOpenTask({ leadId: this.recordId })
            .then(result => { this.latestTask = result; })
            .catch(error => { console.error('Error fetching task:', error); });
    }

    // ── Navigation ───────────────────────────────────────────
    goToAddComment() {
        this.userInput = '';
        this.currentView = 'addComment';
    }

    goToCreateTask() {
        this.newTaskSubject = '';
        this.newTaskComment = '';
        this.currentView = 'createTask';
    }

    goBack() {
        this.currentView = 'home';
        this.userInput = '';
    }

    // ── Input Handlers ───────────────────────────────────────
    handleInputChange(event)          { this.userInput = event.target.value; }
    handleSubjectChange(event)        { this.newTaskSubject = event.target.value; }
    handleCreateCommentChange(event)  { this.newTaskComment = event.target.value; }

    // ── Speech Recognition ───────────────────────────────────
    handleListen(event) {
        // Find which field to populate
        const field = event.currentTarget.dataset.field;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.showToast('Error', 'Browser does not support Speech Recognition', 'error');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = this.selectedLang;
        recognition.interimResults = false;
        this.isListening = true;

        recognition.start();

        recognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            if (field === 'comment')       this.userInput = transcript;
            if (field === 'createComment') this.newTaskComment = transcript;
            this.isListening = false;
        };

        recognition.onerror   = () => { this.isListening = false; };
        recognition.onspeechend = () => { recognition.stop(); this.isListening = false; };
    }

    // ── Update Existing Task ─────────────────────────────────
    handleUpdate() {
        if (!this.userInput || this.userInput.trim() === '') {
            this.showToast('Wait', 'Please enter a comment', 'warning');
            return;
        }
        this.isProcessing = true;

        updateLatestTask({ taskId: this.latestTask.Id, comment: this.userInput })
            .then(() => {
                this.showToast('Success', 'Comment saved in English!', 'success');
                this.userInput = '';
                this.currentView = 'home';
            })
            .catch(error => {
                console.error('Update Error:', error);
                this.showToast('Error', 'Failed to update task', 'error');
            })
            .finally(() => { this.isProcessing = false; });
    }

    // ── Create New Task ──────────────────────────────────────
    handleCreateTask() {
        if (!this.newTaskSubject || this.newTaskSubject.trim() === '') {
            this.showToast('Wait', 'Please enter a subject', 'warning');
            return;
        }
        if (!this.newTaskComment || this.newTaskComment.trim() === '') {
            this.showToast('Wait', 'Please enter a comment', 'warning');
            return;
        }
        this.isProcessing = true;

        createTask({
            leadId:  this.recordId,
            subject: this.newTaskSubject,
            comment: this.newTaskComment
        })
            .then(() => {
                this.showToast('Success', 'Task created successfully!', 'success');
                this.newTaskSubject = '';
                this.newTaskComment = '';
                this.currentView = 'home';
                this.fetchTask(); // refresh latest task
            })
            .catch(error => {
                console.error('Create Error:', error);
                this.showToast('Error', 'Failed to create task', 'error');
            })
            .finally(() => { this.isProcessing = false; });
    }

    // ── Toast Helper ─────────────────────────────────────────
    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
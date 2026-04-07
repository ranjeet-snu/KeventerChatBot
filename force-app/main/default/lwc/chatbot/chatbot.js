import { LightningElement, api, track } from 'lwc';
import getLatestOpenTask from '@salesforce/apex/LeadChatBotController.getLatestOpenTask';
import updateLatestTask from '@salesforce/apex/LeadChatBotController.updateLatestTask';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class Chatbot extends LightningElement {
    @api recordId;
    @track isOpen = false;
    @track userInput = '';
    @track latestTask;
    @track isListening = false;
    @track isProcessing = false;
    @track selectedLang = 'en-US'; // Default Language

    // Computed properties for UI states
    get isDisabled() { return !this.latestTask || this.isProcessing; }
    get placeholderText() { 
        if (this.isProcessing) return "Updating...";
        return this.latestTask ? "Type or use mic..." : "Input disabled"; 
    }
    
    get inputWrapperClass() { return this.isDisabled ? 'input-wrapper disabled-bg' : 'input-wrapper'; }
    get chatIconClass() { return this.isOpen ? 'chat-bubble hidden' : 'chat-bubble visible pulse'; }
    get micClass() { return this.isListening ? 'mic-btn listening' : 'mic-btn'; }
    get micVariant() { return this.isListening ? 'error' : 'default'; }

    // Language Chip Active States
    get engChipClass() { return this.selectedLang === 'en-US' ? 'lang-chip active' : 'lang-chip'; }
    get hinChipClass() { return this.selectedLang === 'hi-IN' ? 'lang-chip active' : 'lang-chip'; }
    get benChipClass() { return this.selectedLang === 'bn-IN' ? 'lang-chip active' : 'lang-chip'; }

    // Language Switcher Methods
    setEnglish() { this.selectedLang = 'en-US'; }
    setHindi() { this.selectedLang = 'hi-IN'; }
    setBengali() { this.selectedLang = 'bn-IN'; }

    async toggleChat() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.fetchTask();
        }
    }

    fetchTask() {
        getLatestOpenTask({ leadId: this.recordId })
            .then(result => { 
                this.latestTask = result; 
            })
            .catch(error => { 
                console.error('Error fetching task:', error); 
            });
    }

    handleInputChange(event) { this.userInput = event.target.value; }

    handleListen() {
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

        recognition.onresult = (event) => {
            this.userInput = event.results[0][0].transcript;
            this.isListening = false;
        };

        recognition.onerror = () => { this.isListening = false; };
        recognition.onspeechend = () => { 
            recognition.stop(); 
            this.isListening = false; 
        };
    }

    handleUpdate() {
        if (!this.userInput || this.userInput.trim() === '') {
            this.showToast('Wait', 'Please enter a comment', 'warning');
            return;
        }
        
        this.isProcessing = true;

        updateLatestTask({ taskId: this.latestTask.Id, comment: this.userInput })
            .then(() => {
                this.showToast('Success', 'Comments added', 'success');
                this.userInput = '';
                this.isOpen = false;
            })
            .catch(error => { 
                console.error('Update Error:', error);
                this.showToast('Error', 'Failed to update task', 'error');
            })
            .finally(() => { 
                this.isProcessing = false; 
            });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
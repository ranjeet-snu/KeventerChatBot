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

    // Computed properties for UI states
    get isDisabled() { return !this.latestTask; }
    get placeholderText() { return this.latestTask ? "Type or use mic..." : "Input disabled"; }
    get inputWrapperClass() { return this.isDisabled ? 'input-wrapper disabled-bg' : 'input-wrapper'; }
    get chatIconClass() { return this.isOpen ? 'chat-bubble hidden' : 'chat-bubble visible pulse'; }
    get micClass() { return this.isListening ? 'mic-btn listening' : 'mic-btn'; }
    get micVariant() { return this.isListening ? 'error' : 'default'; }

    async toggleChat() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.fetchTask();
        }
    }

    fetchTask() {
        getLatestOpenTask({ leadId: this.recordId })
            .then(result => { this.latestTask = result; })
            .catch(error => { console.error(error); });
    }

    handleInputChange(event) { this.userInput = event.target.value; }

    handleListen() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        this.isListening = true;
        recognition.start();
        recognition.onresult = (event) => {
            this.userInput = event.results[0][0].transcript;
            this.isListening = false;
        };
        recognition.onerror = () => { this.isListening = false; };
    }

    handleUpdate() {
        if (!this.userInput) return;
        updateLatestTask({ taskId: this.latestTask.Id, comment: this.userInput })
            .then(() => {
                this.dispatchEvent(new ShowToastEvent({ title: 'Success', message: 'Comments added', variant: 'success' }));
                this.userInput = '';
                this.isOpen = false;
            })
            .catch(error => { console.error(error); });
    }
}
import { LightningElement, api, track } from 'lwc';
import updateLatestTask from '@salesforce/apex/LeadChatBotController.updateLatestTask';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class Chatbot extends LightningElement {
    @api recordId; // Automatically gets Lead ID from the page
    @track isOpen = false;
    @track userInput = '';
    @track isListening = false;
    @track isProcessing = false;

    get chatIconClass() {
        return this.isOpen ? 'chat-bubble hidden' : 'chat-bubble visible pulse';
    }

    get micClass() {
        return this.isListening ? 'mic-btn listening' : 'mic-btn';
    }

    get micVariant() {
        return this.isListening ? 'error' : 'default';
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
    }

    handleInputChange(event) {
        this.userInput = event.target.value;
    }

    // Voice to Text functionality
    handleListen() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.showToast('Error', 'Browser does not support Speech Recognition', 'error');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        
        if (!this.isListening) {
            this.isListening = true;
            recognition.start();
        }

        recognition.onresult = (event) => {
            this.userInput = event.results[0][0].transcript;
            this.isListening = false;
        };

        recognition.onerror = () => {
            this.isListening = false;
        };
    }

    handleUpdate() {
    // Check if input is empty
    if (!this.userInput || this.userInput.trim() === '') {
        this.showToast('Wait!', 'Please enter or speak a comment first.', 'warning');
        return;
    }

    this.isProcessing = true;

    updateLatestTask({ leadId: this.recordId, comment: this.userInput })
        .then(() => {
            // Updated success message as requested
            this.showToast('Success', 'Comments added', 'success');
            this.userInput = '';
            this.isOpen = false; // Minimize after success
        })
        .catch(error => {
            // Log error to console for debugging
            console.error('Update Error: ', error);
            let message = 'Unknown error';
            if (error.body && error.body.message) {
                message = error.body.message;
            }
            this.showToast('Error', message, 'error');
        })
        .finally(() => { 
            this.isProcessing = false; 
        });
}

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
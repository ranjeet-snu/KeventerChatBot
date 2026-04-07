import { LightningElement, track, api, wire } from 'lwc';
import startChatSession from '@salesforce/apex/EinsteinChatController.startChatSession';
import sendChatMessage from '@salesforce/apex/EinsteinChatController.sendChatMessage';
import getLanguageMapJson from '@salesforce/apex/EinsteinChatController.getLanguageMapJson';
import agentforceBot from '@salesforce/resourceUrl/agentforce_bot';
import agentforceBgForHome from '@salesforce/resourceUrl/agentforce_bg_for_home_screen';
import agentforceBgForChat from '@salesforce/resourceUrl/agentforce_bg_for_chat_screen';
import agentBotAvatar from '@salesforce/resourceUrl/agent_bot_avatar';
import getMetadataInfo from '@salesforce/apex/EinsteinChatController.getMetadataInfo';
import speechRecognizerWrapper from '@salesforce/resourceUrl/speechRecognizerWrapper';
import generateResponse from '@salesforce/apex/GeminiController.generateResponse';

export default class CustomAgentforceAgent extends LightningElement {

     envInfo;
    @track isLoading = true;
    @api agentforceAgentId;
    @track messages = [];
    @track userInput = '';
    @track showWelcomeScreen = true;
    @track languageOptions = [];
    @track languageMap = {};
    @track agentLoadingMessage;
    @track agentJoinedMessage;
    @track agentPlaceholder;
    @track AgentName;
    @track HomeScreenAgentWidth = '220px';   // default fallback
    @track HomeScreenAgentHeight = '220px';

    sessionId = null;
    isSending = false;

    // 🔧 Resizing state variables
    isResizing = false;
    startY = 0;
    startHeight = 0;
    boundPerformResize;
    boundStopResize;

    @track isListening = false;
    recognition;

    @track selectedLanguage = 'English (US)';

    iframeUrl = speechRecognizerWrapper + '/speech.html';

    voiceOptions = [
    { label: 'Alloy', value: 'alloy' },
    { label: 'Nova', value: 'nova' },
    { label: 'Echo', value: 'echo' },
    { label: 'Onyx', value: 'onyx' },
    { label: 'Fable', value: 'fable' }
];
selectedVoice = 'alloy';

// Keep track of the currently speaking message
    currentUtterance = null;
    currentlySpeakingMsgId = null;

    @wire(getLanguageMapJson)
    wiredLanguages({ error, data }) {
        if (data) {
            try {
                this.languageMap = JSON.parse(data);
                this.languageOptions = Object.keys(this.languageMap).map(key => ({
                    label: key,
                    value: key
                }));
            } catch (e) {
                console.error('Error parsing language JSON:', e);
                this.languageMap = {};
                this.languageOptions = [];
            }
        } else if (error) {
            console.error('Error fetching language map:', error);
        }
    }
    @wire(getMetadataInfo)
    wiredMetadataInfo({ error, data }) {
        if (data) {
            try {
                this.agentLoadingMessage = data.Agent_Loading_Message__c;
                this.agentJoinedMessage = data.Agent_Joined_Message__c;
                this.agentPlaceholder = data.Placeholder_For_Agent_Home_Screen__c;
                this.AgentName = data.Agent_Name__c;
                this.HomeScreenAgentWidth = data.Home_Screen_Bot_Image_Width__c;
                this.HomeScreenAgentHeight = data.Home_Screen_Bot_Image_Height__c;
                this.HomeScreenBitImageStyle();
                this.isLoading = false;
            } catch (e) {
                this.isLoading = false;
                console.error('Error parsing Metadata Info:', e.message);

            }
        } else if (error) {
            this.isLoading = false;
            console.error('Error fetching Metadata Info:', error);
        }
    }
    HomeScreenBitImageStyle() {
        this.HomeScreenBitImageStyle = `width: ${this.HomeScreenAgentWidth}; height: ${this.HomeScreenAgentHeight};`;
        console.log('this.HomeScreenBitImageStyle:', this.HomeScreenBitImageStyle);
    }

    get botImage() {
        return agentforceBot;
    }
    get botIcon() {
        return agentBotAvatar;
    }
    get welcomeScreenStyle() {
        return `background-image: url('${agentforceBgForHome}');
                background-repeat: no-repeat;
                background-size: cover;
                background-position: center center;
                height: 100vh; 
                padding: 2rem;
                display: flex;
                flex-direction: column;
                justify-content: center;`;
    }

    get chatWindowStyle() {
        return `background-image: url('${agentforceBgForChat}');
                background-repeat: no-repeat;
                background-size: cover;
                background-position: center center;
                flex-grow: 1;
                overflow-y: auto;
                min-height: 150px;
                max-height: 80vh;
                border: 1px solid #ccc;
                scroll-behavior: smooth;
                height: 300px; /* initial height */
                flex-shrink: 0;`;
    }

    get recognitionLang() {
        // fallback to en-US if key not found
        return this.languageMap[this.selectedLanguage] || 'en-US';
    }

    connectedCallback() {
        console.log('Agentforce Id', this.agentforceAgentId);
        this.boundPerformResize = this.performResize.bind(this);
        this.boundStopResize = this.stopResize.bind(this);

        window.addEventListener('mousemove', this.boundPerformResize);
        window.addEventListener('mouseup', this.boundStopResize);
        window.addEventListener('message', this.handleSpeechResult.bind(this));


    }


handleSpeechResult(event) {
    const data = event.data;

    // 🎙️ Handle transcript result
    if (typeof data === 'object' && data.transcript) {
        this.userInput = data.transcript;
        this.isListening = false;

        this.showWelcomeScreen ? this.startChat() : this.sendMessage();
    } 
    // ❗ Handle errors
    else if (typeof data === 'object' && data.error) {
        console.error('Speech recognition error:', data.error);
        this.isListening = false;
        alert('Speech recognition error: ' + data.error + '--> Allow the microphone ');
    }
}


    handleLanguageChange(event) {
        this.selectedLanguage = event.detail.value;
        // You can add further logic here if you want to change content dynamically
        console.log('Selected language:', this.selectedLanguage);
    }

    renderedCallback() {
        const chatWindow = this.template.querySelector('.chat-window');
        if (chatWindow) {
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
    }


    disconnectedCallback() {
        window.removeEventListener('mousemove', this.boundPerformResize);
        window.removeEventListener('mouseup', this.boundStopResize);
    }

    startResize = (event) => {
        this.isResizing = true;
        this.startY = event.clientY;
        const chatWindow = this.template.querySelector('.chat-window');
        this.startHeight = chatWindow.offsetHeight;
    };

    performResize = (event) => {
        if (!this.isResizing) return;
        const delta = event.clientY - this.startY;
        const chatWindow = this.template.querySelector('.chat-window');
        chatWindow.style.height = `${this.startHeight + delta}px`;
    };

    stopResize = () => {
        this.isResizing = false;
    };

    handleInput(event) {
        this.userInput = event.target.value;
    }

    async startChat() {
        if (!this.userInput.trim()) return;

        this.showWelcomeScreen = false;

        await this.initChat();

        // Add user's first message right after welcome
        this.sendMessage();
    }

    async initChat() {
        this.isLoading = true;
        try {
            const welcomeMsgObj = await startChatSession({ AgentId: this.agentforceAgentId });
            this.sessionId = welcomeMsgObj.sessionId;

            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            const dateString = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

            this.messages = [
                {
                    id: Date.now(),
                    text: `${dateString} • ${timeString}`,
                    isSystem: true
                },
                {
                    id: Date.now() + 1,
                    text: this.agentJoinedMessage,
                    isSystem: true
                },
                {
                    id: Date.now() + 2,
                    text: welcomeMsgObj.message,
                    isBot: true
                }
            ];
            this.isLoading = false;
        } catch (error) {
            this.messages = [
                {
                    id: Date.now(),
                    text: 'Failed to start chat session.',
                    isBot: true
                }
            ];
            this.isLoading = false;
            console.error(error);
        }
    }

    /*async sendMessage() {
    if (!this.userInput.trim() || this.isSending) return;

    const messageText = this.userInput.trim();
    const timestamp = Date.now();

    this.messages = [...this.messages, {
        id: timestamp,
        text: messageText,
        isUser: true
    }];
    this.userInput = '';
    this.isSending = true;

    try {
        const response = await sendChatMessage({
            sessionId: this.sessionId,
            message: messageText
        });
        console.log('Raw response:', response);

        // Extract options (e.g., 1. View Details), remove any URLs in parentheses
        const options = [];
        const optionRegex = /^\d+\.\s(.+)$/gm;
        let match;
        while ((match = optionRegex.exec(response)) !== null) {
            let cleanedOption = match[1].replace(/\s*\(https?:\/\/[^\s)]+\)/g, '').trim();
            options.push(cleanedOption);
        }

        // Extract projectCards dynamically from multi-line formats
        const projectCards = [];

// Match either:
// 1. Lines like: 1. "Abacus" (https://...)
// 2. Or: Title line above -> then line like: "Abacus" (https://...)
const lines = response.split('\n');
for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Match pattern like: 1. "Abacus" (https://...)
    let match = line.match(/^(\d+)\.\s+"(.+?)"\s+\((https?:\/\/[^\s)]+)\)$/);
    if (match) {
        projectCards.push({
            number: match[1],
            name: match[2],
            imageUrl: match[3],
            displayText: `${match[1]}. ${match[2]}`
        });
        continue;
    }

    // Match pattern like: "Title" (https://...)
    match = line.match(/^"(.+?)"\s+\((https?:\/\/[^\s)]+)\)$/);
    if (match && i > 0) {
        // Try to get preceding line if it's a number+title
        const prevLine = lines[i - 1].trim();
        const numberMatch = prevLine.match(/^(\d+)\.\s+(.+)$/);
        const number = numberMatch ? numberMatch[1] : (projectCards.length + 1).toString();
        const displayTitle = numberMatch ? numberMatch[2] : match[1];
        projectCards.push({
            number: number,
            name: match[1],
            imageUrl: match[2],
            displayText: `${number}. ${displayTitle}`
        });
    }
}

// Now remove all matched image lines from bot message
const cleanText = lines
    .filter(line =>
        !line.match(/^(\d+)\.\s+"(.+?)"\s+\((https?:\/\/[^\s)]+)\)$/) &&
        !line.match(/^"(.+?)"\s+\((https?:\/\/[^\s)]+)\)$/)
    )
    .join('\n')
    .trim();

    // ✅ 🔊 Speak cleanText using SpeechSynthesis
if (cleanText) {
    try {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = this.recognitionLang || 'en-US'; // Use your dynamic language
        utterance.rate = 1; // Normal speed
        speechSynthesis.speak(utterance);
    } catch (err) {
        console.error('TTS failed:', JSON.stringify(err));
    }
}

    // inside sendMessage
// if (cleanText) {
//     try {
//         const speechUrl = await getSpeechUrl(cleanText, this.selectedVoice || 'alloy');; // other voices: nova, onyx, echo, fable
//         const audio = new Audio(speechUrl);
//         audio.play();
//     } catch (err) {
//         console.error('TTS failed:', err);
//     }
// }

        const botMessage = {
            id: timestamp + 1,
            text: cleanText || 'Here are the matching projects:',
            isBot: true,
            options: options.length > 0 ? options : undefined,
            projectCards: projectCards.length > 0 ? projectCards : undefined
        };

        this.messages = [...this.messages, botMessage];

    } catch (error) {
        const errorText = error?.body?.message || error?.message || JSON.stringify(error);
        this.messages = [...this.messages, {
            id: timestamp + 1,
            text: 'Failed to send message. ' + errorText,
            isBot: true
        }];
    } finally {
        this.isSending = false;
    }
}*/

async sendMessage() {
    if (!this.userInput.trim() || this.isSending) return;

    const messageText = this.userInput.trim();
    console.log('Send Message',messageText);
    const timestamp = Date.now();

    this.messages = [...this.messages, {
        id: timestamp,
        text: messageText,
        isUser: true
    }];
    this.userInput = '';
    this.isSending = true;

    try {
        const response = await sendChatMessage({
            sessionId: this.sessionId,
            message: messageText
        });
        console.log('Raw response:', response);

        // Extract options
        const options = [];
        const optionRegex = /^\d+\.\s(.+)$/gm;
        let match;
        while ((match = optionRegex.exec(response)) !== null) {
            let cleanedOption = match[1].replace(/\s*\(https?:\/\/[^\s)]+\)/g, '').trim();
            options.push(cleanedOption);
        }

        // Extract project cards
        const projectCards = [];
        const lines = response.split('\n');
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();

            // Match: 1. "Project Name" (https...)
            let match = line.match(/^(\d+)\.\s+"(.+?)"\s+\((https?:\/\/[^\s)]+)\)$/);
            if (match) {
                projectCards.push({
                    number: match[1],
                    name: match[2],
                    imageUrl: match[3],
                    displayText: `${match[1]}. ${match[2]}`
                });
                continue;
            }

            // Match: "Project Name" (https...) [no number]
            match = line.match(/^"(.+?)"\s+\((https?:\/\/[^\s)]+)\)$/);
            if (match && i > 0) {
                const prevLine = lines[i - 1].trim();
                const numberMatch = prevLine.match(/^(\d+)\.\s+(.+)$/);
                const number = numberMatch ? numberMatch[1] : (projectCards.length + 1).toString();
                const displayTitle = numberMatch ? numberMatch[2] : match[1];
                projectCards.push({
                    number: number,
                    name: match[1],
                    imageUrl: match[2],
                    displayText: `${number}. ${displayTitle}`
                });
            }
        }

        // Remove image/project lines from text
        const cleanText = lines
            .filter(line =>
                !line.match(/^(\d+)\.\s+"(.+?)"\s+\((https?:\/\/[^\s)]+)\)$/) &&
                !line.match(/^"(.+?)"\s+\((https?:\/\/[^\s)]+)\)$/)
            )
            .join('\n')
            .trim();

            console.log('cleanText', cleanText);

        // 🌍 Translate and display full message
        if (cleanText) {
            try {
                const convertedText = await generateResponse({
                    prompt: cleanText,
                    inputLanguage: this.recognitionLang || 'en-US'
                });

                console.log('convertedText', JSON.stringify(convertedText));

                // Clean translation output (Gemini preface)
                let cleanedTranslatedText = convertedText
                    ?.replace(/Okay, I will translate.*?(version:)?/i, '')
                    ?.trim();

                // Extract translated options using Unicode digits
                const translatedOptions = [];
                const universalOptionRegex = /^[\d\u0966-\u096F\u09E6-\u09EF\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0660-\u0669]+\.\s*(.+)$/gm;
                let m;
                while ((m = universalOptionRegex.exec(cleanedTranslatedText)) !== null) {
                    translatedOptions.push(m[1].trim());
                }

                // Push final translated bot message
                const translatedMessage = {
    id: Date.now() + 2,
    text: cleanedTranslatedText || cleanText,
    isBot: true,
    isTranslated: true,
    isSpeaking: false,
    iconName: 'utility:play',
    altText: 'Play voice',
    options: translatedOptions.length > 0 ? translatedOptions : undefined,
    projectCards: projectCards.length > 0 ? projectCards : undefined
};

                this.messages = [...this.messages, translatedMessage];

            } catch (err) {
                console.error('Convert failed:', JSON.stringify(err));
            }
        }

    } catch (err) {
        console.error('Chat error:', JSON.stringify(err));
    } finally {
        this.isSending = false;
    }
}


    handleKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.showWelcomeScreen ? this.startChat() : this.sendMessage();
        }
    }

    get isSendDisabled() {
        return this.isSending || !this.userInput.trim();
    }
    handleOptionClick(event) {
        const optionText = event.target.dataset.option;
        if (!optionText) return;

        // If userInput already has some text, append with comma, else just set it
        if (this.userInput && this.userInput.trim().length > 0) {
            this.userInput = this.userInput.trim() + ', ' + optionText;
        } else {
            this.userInput = optionText;
        }
    }
    // 🎤 Called when mic icon is clicked
    

toggleMic() {
    const iframe = this.template.querySelector('iframe');
    if (iframe && iframe.contentWindow) {
        this.isListening = !this.isListening;
        console.log('Toggling mic. Now listening:', this.isListening);
        console.log('Language', this.recognitionLang);

        iframe.contentWindow.postMessage({
            command: 'setLang',
            lang: this.recognitionLang
        }, '*');

        iframe.contentWindow.postMessage({ command: 'toggle' }, '*');
    } else {
        console.warn('Iframe not found or not loaded.');
    }
}


    get micIcon() {
        return this.isListening ? 'utility:unmuted' : 'utility:muted';
    }


    get micButtonLabel() {
        return this.isListening ? 'Stop Listening' : 'Start Listening';
    }

/*handleVoiceChange(event) {
    this.selectedVoice = event.detail.value;
}*/
handlePlayVoice(event) {
    const msgText = event.currentTarget.dataset.msgtext;
    if (msgText) {
        try {
            const utterance = new SpeechSynthesisUtterance(msgText);
            utterance.lang = this.recognitionLang || 'en-US';
            utterance.rate = 1;
            speechSynthesis.cancel(); // stop any ongoing
            speechSynthesis.speak(utterance);
        } catch (err) {
            console.error('Play voice failed:', JSON.stringify(err));
        }
    }
}
handleToggleVoice(event) {
        const msgId = event.currentTarget.dataset.msgid;
        const msgText = event.currentTarget.dataset.msgtext;

        // Stop current speaking
        if (this.currentlySpeakingMsgId && this.currentlySpeakingMsgId !== msgId) {
            speechSynthesis.cancel();
            this.updateMessageSpeakingState(this.currentlySpeakingMsgId, false);
        }

        const isCurrentlySpeaking = this.currentlySpeakingMsgId === msgId;

        if (isCurrentlySpeaking && speechSynthesis.speaking) {
            speechSynthesis.cancel();
            this.updateMessageSpeakingState(msgId, false);
            this.currentlySpeakingMsgId = null;
            return;
        }

        // Start speaking
        const utterance = new SpeechSynthesisUtterance(msgText);
        utterance.lang = this.recognitionLang || 'en-US';
        utterance.rate = 1;

        utterance.onend = () => {
            this.updateMessageSpeakingState(msgId, false);
            this.currentlySpeakingMsgId = null;
        };

        this.currentUtterance = utterance;
        this.currentlySpeakingMsgId = msgId;

        this.updateMessageSpeakingState(msgId, true);
        speechSynthesis.speak(utterance);
    }

    updateMessageSpeakingState(msgId, isSpeaking) {
        this.messages = this.messages.map(msg => {
            if (msg.id.toString() === msgId) {
                return {
                    ...msg,
                    isSpeaking,
                    iconName: isSpeaking ? 'utility:pause' : 'utility:play',
                    altText: isSpeaking ? 'Pause voice' : 'Play voice'
                };
            } else {
                return {
                    ...msg,
                    isSpeaking: false,
                    iconName: 'utility:play',
                    altText: 'Play voice'
                };
            }
        });
    }

}
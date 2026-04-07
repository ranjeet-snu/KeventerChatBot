/**
 * @description
 * Apex controller that handles AI chat session management for Einstein AI Agent using REST APIs.
 * It supports:
 *  - Starting a new chat session
 *  - Sending messages to an existing session
 *  - Fetching configuration metadata
 *  - Returning predefined language and UI texts from custom metadata
 * 
 * Dependencies:
 *  - Custom_Agent_Configuration__mdt (Custom Metadata Type for agent config)
 *  - EinsteinAuthService (handles token authentication)
 * Test class - EinsteinChatControllerTest
 * Author - Reetabrata
 */

public class EinsteinChatController {
    
    /**
     * Starts a new chat session with Einstein AI Agent.
     *
     * @param AgentId Optional custom Agent ID; if not provided, default is taken from CMDT.
     * @return Map containing `sessionId` and initial `message` from the agent.
     * @throws AuraHandledException if API call fails or configuration is invalid.
     */
    @AuraEnabled
    public static Map<String, String> startChatSession(String AgentId) {
        // Load and validate config
        Custom_Agent_Configuration__mdt config = getValidatedConfig();
        String accessToken = EinsteinAuthService.getAccessToken();

        // Determine agent ID
        String AgentforceAgentId = String.isNotBlank(AgentId) ? AgentId : config.Agentforce_Agent_ID__c;

        // Prepare HTTP request for session creation
        HttpRequest req = new HttpRequest();
        req.setEndpoint(config.Api_Base_URL__c + '/einstein/ai-agent/v1/agents/' + AgentforceAgentId + '/sessions');
        req.setMethod('POST');
        req.setHeader('Authorization', 'Bearer ' + accessToken);
        req.setHeader('Content-Type', 'application/json');

        // Generate unique session key
        String uuid = String.valueOf(UUID.randomUUID());

        // Create request body
        String body = JSON.serialize(new Map<String, Object>{
            'externalSessionKey' => uuid,
            'instanceConfig' => new Map<String, String>{
                'endpoint' => config.Domain_URL__c
            },
            'streamingCapabilities' => new Map<String, Object>{
                'chunkTypes' => new List<String>{ 'Text' }
            },
            'bypassUser' => true
        });
        req.setBody(body);

        // Execute HTTP callout
        Http http = new Http();
        HttpResponse res = http.send(req);

        // Parse and return response
        if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
            Map<String, Object> response = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

            String sessionId = (String) response.get('sessionId');
            List<Object> messages = (List<Object>) response.get('messages');

            String welcomeMsg = 'Hello!';
            if (messages != null && !messages.isEmpty()) {
                Map<String, Object> firstMsg = (Map<String, Object>) messages[0];
                if (firstMsg.containsKey('message')) {
                    welcomeMsg = (String) firstMsg.get('message');
                }
            }

            return new Map<String, String>{
                'sessionId' => sessionId,
                'message' => welcomeMsg
            };
        } else {
            throw new AuraHandledException('Failed to start chat session. Status=' + res.getStatusCode() + ', Body=' + res.getBody());
        }
    }

    /**
     * Sends a user message to an active Einstein chat session.
     *
     * @param sessionId ID of the chat session to send message to.
     * @param message Text message to send.
     * @return The last AI response message.
     * @throws AuraHandledException if sessionId or message is missing, or API fails.
     */
    @AuraEnabled
    public static String sendChatMessage(String sessionId, String message) {
        // Validate input
        if (String.isBlank(sessionId)) {
            throw new AuraHandledException('SessionId is required');
        }
        if (String.isBlank(message)) {
            throw new AuraHandledException('Message is required');
        }

        // Load config and access token
        Custom_Agent_Configuration__mdt config = getValidatedConfig();
        String accessToken = EinsteinAuthService.getAccessToken();

        // Prepare request
        HttpRequest req = new HttpRequest();
        req.setEndpoint(config.Api_Base_URL__c + '/einstein/ai-agent/v1/sessions/' + sessionId + '/messages');
        req.setMethod('POST');
        req.setHeader('Authorization', 'Bearer ' + accessToken);
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(30000); // Set timeout to 30 seconds (can go up to 120000 ms)

        // Create message payload
        Long sequenceId = DateTime.now().getTime();
        Map<String, Object> messagePayload = new Map<String, Object>{
            'message' => new Map<String, Object>{
                'sequenceId' => sequenceId,
                'type' => 'Text',
                'text' => message
            },
            'variables' => new List<Object>()
        };
        req.setBody(JSON.serialize(messagePayload));

        // Call API
        Http http = new Http();
        HttpResponse res = http.send(req);

        // Handle response
        if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
            Map<String, Object> response = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());

            List<Object> messages = (List<Object>) response.get('messages');
            if (messages != null && !messages.isEmpty()) {
                Map<String, Object> lastMsg = (Map<String, Object>) messages[messages.size() - 1];
                if (lastMsg.containsKey('message')) {
                    return (String) lastMsg.get('message');
                }
            }
            return 'No response message received.';
        } else {
            throw new AuraHandledException('Failed to send message. Status=' + res.getStatusCode() + ', Body=' + res.getBody());
        }
    }

    /**
     * Validates that the Custom Metadata is configured correctly.
     *
     * @return Valid Custom_Agent_Configuration__mdt record.
     * @throws AuraHandledException if no valid configuration is found.
     */
    @TestVisible
    private static Custom_Agent_Configuration__mdt getValidatedConfig() {
        List<Custom_Agent_Configuration__mdt> configs = [
            SELECT Api_Base_URL__c, Agentforce_Agent_ID__c, Domain_URL__c
            FROM Custom_Agent_Configuration__mdt
            LIMIT 1
        ];

        if (configs.isEmpty()) {
            throw new AuraHandledException('Custom Metadata configuration not found.');
        }

        Custom_Agent_Configuration__mdt config = configs[0];
        if (String.isBlank(config.Api_Base_URL__c) ||
            String.isBlank(config.Agentforce_Agent_ID__c) ||
            String.isBlank(config.Domain_URL__c)) {
            throw new AuraHandledException('Custom Metadata is missing required values.');
        }

        return config;
    }

    /**
     * Fetches the serialized language map JSON from custom metadata.
     *
     * @return JSON string representing available languages.
     */
    @AuraEnabled(cacheable=true)
    public static String getLanguageMapJson() {
        Custom_Agent_Configuration__mdt config = [
            SELECT All_Available_Language__c
            FROM Custom_Agent_Configuration__mdt
            LIMIT 1
        ];
        return config.All_Available_Language__c;
    }

    /**
     * Returns agent UI metadata for configuring the chat interface.
     *
     * @return CMDT record with UI strings like loading message, agent name, etc.
     */
    @AuraEnabled(cacheable=true)
    public static Custom_Agent_Configuration__mdt getMetadataInfo() {
        Custom_Agent_Configuration__mdt config = [
            SELECT Agent_Loading_Message__c, Agent_Joined_Message__c,
                   Placeholder_For_Agent_Home_Screen__c, Agent_Name__c,Home_Screen_Bot_Image_Height__c,
            Home_Screen_Bot_Image_Width__c
            FROM Custom_Agent_Configuration__mdt
            LIMIT 1
        ];
        return config;
    }
}
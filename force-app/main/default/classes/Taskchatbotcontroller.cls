/**
 * @description
 * Apex controller for Task Chatbot Agent.
 * Handles:
 *  - Starting a new Einstein AI Agent chat session (Task Agent)
 *  - Sending messages to the session
 *  - Updating Task Description/Comments field based on agent response
 *  - Fetching config from Custom_Agent_Configuration__mdt
 *
 * Author - Reetabrata
 * Test class - TaskChatBotControllerTest
 */
public class TaskChatBotController {

    /**
     * Starts a new chat session with the Task Einstein Agent.
     * Uses Task_Agent_ID__c from CMDT if available, else falls back to Agentforce_Agent_ID__c.
     *
     * return Map with sessionId and initial welcome message.
     */


    @AuraEnabled
    public static Map<String, String> startTaskChatSession() {
        Custom_Agent_Configuration__mdt config = getValidatedConfig();
        String accessToken = EinsteinAuthService.getAccessToken();

        // Use Task Agent ID if present, else fallback
        // String agentId = String.isNotBlank(config.Task_Agent_ID__c)
        //     ? config.Task_Agent_ID__c
        //     : config.Agentforce_Agent_ID__c;

        String agentId=config.Agentforce_Agent_ID__c;

        HttpRequest req = new HttpRequest();
        req.setEndpoint(config.Api_Base_URL__c + '/einstein/ai-agent/v1/agents/' + agentId + '/sessions');
        req.setMethod('POST');
        req.setHeader('Authorization', 'Bearer ' + accessToken);
        req.setHeader('Content-Type', 'application/json');

        String uuid = String.valueOf(UUID.randomUUID());

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

        Http http = new Http();
        HttpResponse res = http.send(req);

        if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
            Map<String, Object> response = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            String sessionId = (String) response.get('sessionId');
            List<Object> messages = (List<Object>) response.get('messages');

            String welcomeMsg = 'Hello! I can help you update Task descriptions and comments.';
            if (messages != null && !messages.isEmpty()) {
                Map<String, Object> firstMsg = (Map<String, Object>) messages[0];
                if (firstMsg.containsKey('message')) {
                    welcomeMsg = (String) firstMsg.get('message');
                }
            }

            return new Map<String, String>{
                'sessionId' => sessionId,
                'message'   => welcomeMsg
            };
        } else {
            throw new AuraHandledException(
                'Failed to start Task chat session. Status=' + res.getStatusCode() + ', Body=' + res.getBody()
            );
        }
    }

    /**
     * Sends a user message to the Task Einstein Agent session.
     *
     * @param sessionId  Active session ID.
     * @param message    User's message text.
     * @return           Agent's last response text.
     */
    @AuraEnabled
    public static String sendTaskChatMessage(String sessionId, String message) {
        if (String.isBlank(sessionId)) throw new AuraHandledException('SessionId is required');
        if (String.isBlank(message))   throw new AuraHandledException('Message is required');

        Custom_Agent_Configuration__mdt config = getValidatedConfig();
        String accessToken = EinsteinAuthService.getAccessToken();

        HttpRequest req = new HttpRequest();
        req.setEndpoint(config.Api_Base_URL__c + '/einstein/ai-agent/v1/sessions/' + sessionId + '/messages');
        req.setMethod('POST');
        req.setHeader('Authorization', 'Bearer ' + accessToken);
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(30000);

        Long sequenceId = DateTime.now().getTime();
        req.setBody(JSON.serialize(new Map<String, Object>{
            'message' => new Map<String, Object>{
                'sequenceId' => sequenceId,
                'type'       => 'Text',
                'text'       => message
            },
            'variables' => new List<Object>()
        }));

        Http http = new Http();
        HttpResponse res = http.send(req);

        if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
            Map<String, Object> response = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            List<Object> messages = (List<Object>) response.get('messages');
            if (messages != null && !messages.isEmpty()) {
                Map<String, Object> lastMsg = (Map<String, Object>) messages[messages.size() - 1];
                if (lastMsg.containsKey('message')) {
                    return (String) lastMsg.get('message');
                }
            }
            return 'No response received.';
        } else {
            throw new AuraHandledException(
                'Failed to send message. Status=' + res.getStatusCode() + ', Body=' + res.getBody()
            );
        }
    }

    /**
     * Updates the Description (and optionally Comments) field on a Task record.
     *
     * @param taskId      Salesforce Task record ID.
     * @param description New description/comment text from the agent.
     * @return            Success message with Task Subject.
     */
    @AuraEnabled
    public static String updateTaskDescription(String taskId, String description) {
        if (String.isBlank(taskId))     throw new AuraHandledException('Task ID is required');
        if (String.isBlank(description)) throw new AuraHandledException('Description is required');

        try {
            Task t = [SELECT Id, Subject, Description FROM Task WHERE Id = :taskId LIMIT 1];
            t.Description = description;
            update t;
            return 'Task "' + t.Subject + '" updated successfully.';
        } catch (QueryException e) {
            throw new AuraHandledException('Task not found: ' + taskId);
        } catch (DmlException e) {
            throw new AuraHandledException('Failed to update Task: ' + e.getMessage());
        }
    }

    /**
     * Searches for open Tasks by subject keyword, returns Id + Subject list.
     *
     * @param keyword   Search term to match against Task Subject.
     * @return          JSON string of [{id, subject}] matching tasks (max 10).
     */
    @AuraEnabled
    public static String searchTasks(String keyword) {
        String searchTerm = '%' + (String.isBlank(keyword) ? '' : keyword) + '%';
        List<Task> tasks = [
            SELECT Id, Subject, Status, Priority, Description
            FROM Task
            WHERE Subject LIKE :searchTerm
              AND IsClosed = false
            ORDER BY CreatedDate DESC
            LIMIT 10
        ];

        List<Map<String, String>> result = new List<Map<String, String>>();
        for (Task t : tasks) {
            result.add(new Map<String, String>{
                'id'          => t.Id,
                'subject'     => t.Subject,
                'status'      => t.Status,
                'priority'    => t.Priority,
                'description' => t.Description != null ? t.Description : ''
            });
        }
        return JSON.serialize(result);
    }

    /**
     * Fetches agent UI metadata (loading msg, agent name, etc.) from CMDT.
     */
    @AuraEnabled(cacheable=true)
    public static Custom_Agent_Configuration__mdt getTaskAgentMetadata() {
        return [
            SELECT Agent_Loading_Message__c, Agent_Joined_Message__c,
                   Agent_Name__c, Placeholder_For_Agent_Home_Screen__c
            FROM Custom_Agent_Configuration__mdt
            LIMIT 1
        ];
    }

    /**
     * Fetches language map JSON from CMDT.
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

    // ─── Private Helpers ────────────────────────────────────────────────────────

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
        if (String.isBlank(config.Api_Base_URL__c) || String.isBlank(config.Domain_URL__c)) {
            throw new AuraHandledException('Custom Metadata is missing required API values.');
        }
        if (String.isBlank(config.Agentforce_Agent_ID__c)) {
            throw new AuraHandledException('No Agent ID configured in Custom Metadata.');
        }

        return config;
    }
}
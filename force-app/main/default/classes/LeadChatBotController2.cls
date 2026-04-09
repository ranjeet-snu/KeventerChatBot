public with sharing class LeadChatBotController2 {

    @AuraEnabled(cacheable=false)
    public static Task getLatestOpenTask(Id leadId) {
        List<Task> tasks = [SELECT Id, Subject, Description
                            FROM Task WHERE WhoId = :leadId
                            AND IsClosed = false
                            ORDER BY CreatedDate DESC LIMIT 1];
        return tasks.isEmpty() ? null : tasks[0];
    }

    @AuraEnabled
    public static void updateLatestTask(Id taskId, String comment) {
        try {
            if (taskId == null) throw new AuraHandledException('No Task ID provided.');
            // For comments, use Language_Conversion to translate/convert the text
            String processed = processWithPrompt(comment, 'Language_Conversion');
            update new Task(Id = taskId, Description = processed);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static Task createTask(Id leadId, String rawInput) {
        try {
            // For task creation, use Task_comments prompt to extract subject and description
            String aiResponse = processWithPrompt(rawInput, 'Task_comments');

            String finalSubject = '';
            String finalDesc = '';

            // Bulletproof Parsing
            try {
                // Clean the string of any markdown code blocks before parsing
                String jsonStr = aiResponse.trim();
                if (jsonStr.contains('```json')) {
                    jsonStr = jsonStr.substringBetween('```json', '```').trim();
                } else if (jsonStr.contains('```')) {
                    jsonStr = jsonStr.substringBetween('```', '```').trim();
                }

                // Attempt to parse JSON
                Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(jsonStr);
                finalSubject = (String) parsed.get('subject');
                finalDesc = (String) parsed.get('description');
                
            } catch (Exception parseEx) {
                // If JSON fails, check if the AI returned plain text by mistake
                System.debug('JSON Parse Failed. Raw AI Response: ' + aiResponse);
                
                if (aiResponse.containsIgnoreCase('"subject":')) {
                    // Manual extraction if deserialize fails but it looks like JSON
                    finalSubject = aiResponse.substringBetween('"subject": "', '",');
                    finalDesc = aiResponse.substringBetween('"description": "', '"}');
                } else {
                    // Ultimate fallback: don't make them identical
                    finalSubject = rawInput.abbreviate(80); // Just a snippet for the subject
                    finalDesc = aiResponse; // The full text for the description
                }
            }

            // Final safety check to ensure fields aren't empty
            if (String.isBlank(finalSubject)) finalSubject = 'New Task Action Required';
            if (String.isBlank(finalDesc)) finalDesc = rawInput;

            Task t = new Task(
                WhoId       = leadId,
                Subject     = finalSubject.replace('"', '').trim(), // clean rogue quotes
                Description = finalDesc.replace('"', '').trim(),
                Status      = 'Not Started',
                Priority    = 'Normal'
            );
            insert t;
            return t;

        } catch (Exception e) {
            throw new AuraHandledException('Error creating task: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static String processWithPrompt(String inputText, String templateName) {
        try {
            ConnectApi.WrappedValue textValue = new ConnectApi.WrappedValue();
            textValue.value = inputText;

            Map<String, ConnectApi.WrappedValue> inputParams =
                new Map<String, ConnectApi.WrappedValue>();
            inputParams.put('Input:SourceText', textValue);

            ConnectApi.EinsteinPromptTemplateGenerationsInput promptInput =
                new ConnectApi.EinsteinPromptTemplateGenerationsInput();
            promptInput.inputParams      = inputParams;
            promptInput.isPreview        = false;
            promptInput.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
            promptInput.additionalConfig.numGenerations  = 1;
            promptInput.additionalConfig.applicationName = 'PromptTemplateGenerationsInvocable';

            ConnectApi.EinsteinPromptTemplateGenerationsRepresentation output =
                ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(
                    templateName,
                    promptInput
                );
            
            return output.generations[0].text;
        } catch (Exception e) {
            System.debug('Prompt Failed for ' + templateName + ': ' + e.getMessage());
            return inputText; // fallback to original
        }
    }
}
public with sharing class LeadChatBotController2 {

    // Method 1: Get latest open task
    @AuraEnabled(cacheable=false)
    public static Task getLatestOpenTask(Id leadId) {
        List<Task> tasks = [SELECT Id, Subject, Description
                            FROM Task
                            WHERE WhoId = :leadId
                            AND IsClosed = false
                            ORDER BY CreatedDate DESC
                            LIMIT 1];
        return tasks.isEmpty() ? null : tasks[0];
    }

    // Method 2: Update task description via Prompt Builder
    @AuraEnabled
    public static void updateLatestTask(Id taskId, String comment) {
        try {
            if (taskId == null) {
                throw new AuraHandledException('No Task ID provided.');
            }
            // Send to Prompt Builder first
            String processedComment = processWithPrompt(comment);
            Task taskToUpdate = new Task(Id = taskId, Description = processedComment);
            update taskToUpdate;
        } catch (Exception e) {
            throw new AuraHandledException('Error updating task: ' + e.getMessage());
        }
    }

    // Method 3: Create a new Task for the Lead
    @AuraEnabled
    public static Task createTask(Id leadId, String subject, String comment) {
        try {
            // Send comment to Prompt Builder first
            String processedComment = processWithPrompt(comment);
            Task newTask = new Task(
                WhoId       = leadId,
                Subject     = subject,
                Description = processedComment,
                Status      = 'Not Started',
                Priority    = 'Normal'
            );
            insert newTask;
            return newTask;
        } catch (Exception e) {
            throw new AuraHandledException('Error creating task: ' + e.getMessage());
        }
    }

    // Method 4: Process input through Prompt Builder
    @AuraEnabled
    public static String processWithPrompt(String inputText) {
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
                    'Language_Conversion', // ← your template API name
                    promptInput
                );

            return output.generations[0].text;
        } catch (Exception e) {
            // If prompt fails, return original input
            return inputText;
        }
    }
}
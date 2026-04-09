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
            String processed = processWithPrompt(comment);
            update new Task(Id = taskId, Description = processed);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static Task createTask(Id leadId, String subject, String comment) {
        try {
            Task t = new Task(
                WhoId       = leadId,
                Subject     = subject,
                Description = comment,
                Status      = 'Not Started',
                Priority    = 'Normal'
            );
            insert t;
            return t;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

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
                    'Language_Conversion', // ← replace with your template API name
                    promptInput
                );
            return output.generations[0].text;
        } catch (Exception e) {
            return inputText; // fallback to original
        }
    }
}
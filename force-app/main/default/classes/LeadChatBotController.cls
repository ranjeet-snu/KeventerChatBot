public with sharing class LeadChatBotController {
    @AuraEnabled
    public static void updateLatestTask(Id leadId, String comment) {
        // Ensure leadId isn't null
        if (leadId == null) {
            throw new AuraHandledException('Lead ID is missing. Are you on a Lead record page?');
        }

        // Find the most recent task that is not completed
        List<Task> tasks = [SELECT Id, Description 
                            FROM Task 
                            WHERE WhoId = :leadId 
                            AND IsClosed = false 
                            ORDER BY CreatedDate DESC 
                            LIMIT 1];
        
        if(!tasks.isEmpty()) {
            try {
                tasks[0].Description = comment;
                update tasks[0];
            } catch (Exception e) {
                throw new AuraHandledException('Database Error: ' + e.getMessage());
            }
        } else {
            // Throw a specific error if no task is found
            throw new AuraHandledException('No open task found to update for this Lead.');
        }
    }
}
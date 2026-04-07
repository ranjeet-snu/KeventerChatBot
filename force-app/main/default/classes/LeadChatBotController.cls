public with sharing class LeadChatBotController {
    
    /** * Method 1: Fetches the latest open task to display in the Chatbot UI
     * Called when the chatbot icon is clicked
     */
    @AuraEnabled(cacheable=false) 
    public static Task getLatestOpenTask(Id leadId) {
        // We look for tasks linked to the Lead (WhoId) that are NOT closed
        List<Task> tasks = [SELECT Id, Subject, Description 
                            FROM Task 
                            WHERE WhoId = :leadId 
                            AND IsClosed = false 
                            ORDER BY CreatedDate DESC 
                            LIMIT 1];
        
        // Returns the task object if found, otherwise returns null
        return tasks.isEmpty() ? null : tasks[0];
    }

    /** * Method 2: Updates the Description/Comments of the specific Task
     * Called when the user clicks 'Update Lead Task'
     */
    @AuraEnabled
    public static void updateLatestTask(Id taskId, String comment) {
        try {
            // Check if taskId is valid
            if(taskId == null) {
                throw new AuraHandledException('No Task ID provided for update.');
            }
            
            // Perform the update on the Description field
            Task taskToUpdate = new Task(Id = taskId, Description = comment);
            update taskToUpdate;
            
        } catch (Exception e) {
            // Sends the specific error message back to the LWC toast
            throw new AuraHandledException('Error updating task: ' + e.getMessage());
        }
    }
}
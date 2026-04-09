public class PromptBuilderTranslationService {

    @AuraEnabled
    public static String callPromptTemplate(String inputText) {
        
        try {
            // Step 1: Wrap your input value
            ConnectApi.WrappedValue textValue = new ConnectApi.WrappedValue();
            textValue.value = inputText;

            // Step 2: Key must match your template variable name EXACTLY
            Map<String, ConnectApi.WrappedValue> inputParams = 
                new Map<String, ConnectApi.WrappedValue>();
            inputParams.put('Input:SourceText', textValue); // ✅ matches {!$Input:SourceText}

            // Step 3: Build the generation input
            ConnectApi.EinsteinPromptTemplateGenerationsInput promptInput = 
                new ConnectApi.EinsteinPromptTemplateGenerationsInput();
            promptInput.inputParams      = inputParams;
            promptInput.isPreview        = false;
            promptInput.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
            promptInput.additionalConfig.numGenerations  = 1;
            promptInput.additionalConfig.applicationName = 'PromptTemplateGenerationsInvocable';

            // Step 4: Replace with YOUR Template API Name from Prompt Builder
            ConnectApi.EinsteinPromptTemplateGenerationsRepresentation output =
                ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(
                    'Language_Conversion',  // ← change this
                    promptInput
                );

            // Step 5: Return the response
            return output.generations[0].text;

        } catch (Exception e) {
            return 'Error: ' + e.getMessage();
        }
    }
}
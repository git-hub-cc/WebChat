package club.ppmc.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import club.ppmc.dto.SummarizeRequest;
import club.ppmc.service.OpenAIService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

/**
 * Controller for OpenAI API interactions.
 * Provides a main facade endpoint (/v1/chat/completions) that intelligently routes
 * requests to worker endpoints for either base chat or summarization,
 * keeping the client-side logic simple.
 */
@RestController
@RequestMapping("/v1")
public class OpenAIController {

    private static final Logger logger = LoggerFactory.getLogger(OpenAIController.class);

    private final OpenAIService openAIService;
    private final ObjectMapper objectMapper;

    @Autowired
    public OpenAIController(OpenAIService openAIService, ObjectMapper objectMapper) {
        this.openAIService = openAIService;
        this.objectMapper = objectMapper;
        logger.info("OpenAIController initialized successfully.");
    }

    @PostMapping(value = "/chat/completions", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> generateStreamFacade(@RequestBody String body) {
        logger.info("Received request on Facade endpoint: POST /v1/chat/completions");

        String modifiedBody = openAIService.prepareChatContext(body).block();

        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> bodyMap = objectMapper.readValue(modifiedBody, Map.class);

            String user = (String) bodyMap.get("user");
            String characterId = (String) bodyMap.get("character_id");

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) bodyMap.get("messages");

            if (messages != null && messages.size() == 2 && openAIService.hasHistory(user, characterId)) {
                logger.info("Facade: Conditions for summarization met. Routing to summarization logic for user '{}'.", user);
                SummarizeRequest summarizeRequest = new SummarizeRequest(user, characterId);
                return this.summarizeConversation(summarizeRequest);
            }
        } catch (JsonProcessingException e) {
            logger.warn("Facade: Failed to parse modified request body for routing. Defaulting to base chat completion. Error: {}", e.getMessage());
            // 如果解析失败，直接将修改后的（或原始的，如果prepare失败）body转发
            return this.streamBaseChatCompletion(modifiedBody);
        }

        logger.info("Facade: Routing to base chat completion logic.");
        return this.streamBaseChatCompletion(modifiedBody);
    }


    /**
     * -----------------------------------------------------
     * 工作端点 (Worker Endpoints)
     * -----------------------------------------------------
     */

    @PostMapping(value = "/chat/completions/base", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    private Flux<String> streamBaseChatCompletion(@RequestBody String body) {
        logger.info("Received request on Worker endpoint: POST /v1/chat/completions/base");
        logger.debug("Base completion request body: {}", body);
        return openAIService.streamBaseChatCompletion(body);
    }

    @PostMapping(value = "/chat/summarize", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    private Flux<String> summarizeConversation(@RequestBody SummarizeRequest request) {
        logger.info("Received request on Worker endpoint: POST /v1/chat/summarize for user '{}', character '{}'", request.user(), request.character_id());
        String summaryStatusEvent = "data: {\"status\":\"summary\"}\n\n";
        Flux<String> summaryStream = openAIService.getSummaryStream(request.user(), request.character_id());
        return Flux.just(summaryStatusEvent).concatWith(summaryStream);
    }
}
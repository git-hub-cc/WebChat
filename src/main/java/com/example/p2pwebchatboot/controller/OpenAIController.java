package com.example.p2pwebchatboot.controller;

import org.springframework.http.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

@RestController
@RequestMapping("v1")
public class OpenAIController {

    private final WebClient webClient;
    private final RestTemplate restTemplate;
    private static final String base64EncodedKey = "CCQmVhcCCmVyIHNrLWE2M2IzMDdjNWIxNTCCRiZGY5MjkzYjRhZTczYjdmMjc2CC";
    private static final String OPENAI_API_KEY = new String(Base64.getDecoder().decode(base64EncodedKey.replace("CC","")), StandardCharsets.UTF_8);
    private static final String OPENAI_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

    public OpenAIController(WebClient.Builder webClientBuilder, RestTemplate restTemplate) {
        this.webClient = webClientBuilder.baseUrl(OPENAI_API_URL).build();
        this.restTemplate = restTemplate;
    }

    @PostMapping(value = "/chat/completions", produces = MediaType.APPLICATION_JSON_VALUE)
    public Flux<String> generateStream(@RequestBody String body) {
        HttpHeaders headers = new HttpHeaders();
        headers.remove("Authorization");
        headers.set("Authorization", OPENAI_API_KEY);
        headers.set("content-type", MediaType.APPLICATION_JSON_VALUE);

        return webClient.post()
                .uri("/chat/completions")
                .headers(httpHeaders -> httpHeaders.addAll(headers))
                .body(BodyInserters.fromValue(body))
                .retrieve()
                .bodyToFlux(String.class);
    }


    @PostMapping(value = "/images/generations")
    public ResponseEntity<String> generateImage(@RequestBody String body) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", OPENAI_API_KEY);
        headers.set("content-type", MediaType.APPLICATION_JSON_VALUE);
        HttpEntity<String> request = new HttpEntity<>(body, headers);

        return this.restTemplate.exchange(
                OPENAI_API_URL + "/images/generations",
                HttpMethod.POST,
                request,
                String.class
        );
    }

    @PostMapping(value = "/audio/transcriptions")
    public ResponseEntity<String> transcribeAudio(@RequestPart("file") MultipartFile file, @RequestParam("model") String model, @RequestParam("temperature") String temperature
            , @RequestParam("response_format") String response_format, @RequestParam("language") String language) throws IOException {

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", OPENAI_API_KEY);
        headers.set("content-type", MediaType.MULTIPART_FORM_DATA_VALUE);
        MultiValueMap<String, Object> requestBody = new LinkedMultiValueMap<>();
        requestBody.add("file", file.getResource());
        requestBody.add("model", model);
        requestBody.add("temperature", temperature);
        requestBody.add("response_format", response_format);
        requestBody.add("language", language);
        HttpEntity<MultiValueMap<String, Object>> request = new HttpEntity<>(requestBody, headers);

        return this.restTemplate.exchange(
                OPENAI_API_URL + "/audio/transcriptions",
                HttpMethod.POST,
                request,
                String.class
        );
    }

    @PostMapping(value = "/audio/speech")
    public ResponseEntity<byte[]> tts(@RequestBody String body) {

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", OPENAI_API_KEY);
        headers.set("content-type", MediaType.APPLICATION_JSON_VALUE);
        HttpEntity<String> request = new HttpEntity<>(body, headers);

        return this.restTemplate.exchange(
                OPENAI_API_URL + "/audio/speech",
                HttpMethod.POST,
                request,
                byte[].class
        );
    }
}
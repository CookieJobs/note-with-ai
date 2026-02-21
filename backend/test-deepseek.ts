import { DeepSeekApiClient } from './utils/apiClient';
import { config } from './config';

async function run() {
    if (!config.DEEPSEEK_API_KEY) {
        throw new Error("DEEPSEEK_API_KEY is not defined");
    }
    const client = new DeepSeekApiClient(config.DEEPSEEK_API_KEY);
    const messages = [{ role: 'user', content: 'Write a long paragraph about the history of artificial intelligence.' }];
    try {
        const stream = await client.chatCompletionStream(messages);
        console.log('Stream started');
        let count = 0;
        for await (const chunk of stream) {
            process.stdout.write(chunk);
            count++;
        }
        console.log(`\nStream ended. Yielded ${count} chunks.`);
    } catch (err) {
        console.error('Error:', err);
    }
}
run();

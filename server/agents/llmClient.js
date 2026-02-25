// ============================================================
// LLM CLIENT — Thin wrapper around LLM API calls
// Supports OpenAI-compatible APIs. Falls back to templates.
// ============================================================
require('dotenv').config();

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

// Endpoint mapping for providers
const ENDPOINTS = {
    openai: 'https://api.openai.com/v1/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
};

/**
 * Call an LLM with a system prompt and user message.
 * Returns the assistant's text response.
 * Falls back to a template if no API key is configured.
 */
async function callLLM(systemPrompt, userMessage, options = {}) {
    if (!LLM_API_KEY || LLM_API_KEY === 'your_api_key_here') {
        console.warn('[LLM] No API key configured — using fallback mode');
        return fallbackResponse(systemPrompt, userMessage);
    }

    try {
        if (LLM_PROVIDER === 'anthropic') {
            return await callAnthropic(systemPrompt, userMessage, options);
        }
        return await callOpenAICompatible(systemPrompt, userMessage, options);
    } catch (err) {
        console.error('[LLM] API call failed:', err.message);
        return fallbackResponse(systemPrompt, userMessage);
    }
}

// --- OpenAI-compatible API ---
async function callOpenAICompatible(systemPrompt, userMessage, options) {
    const endpoint = options.endpoint || ENDPOINTS.openai;
    const model = options.model || LLM_MODEL;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: options.temperature || 0.7,
            max_tokens: options.maxTokens || 500,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
}

// --- Anthropic API ---
async function callAnthropic(systemPrompt, userMessage, options) {
    const model = options.model || 'claude-sonnet-4-20250514';

    const response = await fetch(ENDPOINTS.anthropic, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': LLM_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: options.maxTokens || 500,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userMessage },
            ],
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    return data.content[0].text.trim();
}

// --- Fallback template responses ---
function fallbackResponse(systemPrompt, userMessage) {
    if (systemPrompt.includes('translator') || systemPrompt.includes('Input Parser')) {
        // Try to parse simple commands
        return generateFallbackIntent(userMessage);
    }

    if (systemPrompt.includes('World Builder') || systemPrompt.includes('eyes and ears')) {
        return 'The space stretches before you, dimly lit and foreboding. The air hangs heavy with dust and the faint tang of something metallic. Shadows pool in the corners, hiding whatever waits within.';
    }

    if (systemPrompt.includes('Showrunner') || systemPrompt.includes('System AI')) {
        return '';  // No flavor text in fallback mode
    }

    if (systemPrompt.includes('Game Master') || systemPrompt.includes('Arbiter')) {
        return userMessage; // Pass through in fallback
    }

    return userMessage;
}

function generateFallbackIntent(input) {
    const lower = input.toLowerCase().trim();

    // Movement
    const dirMap = { north: 'n', south: 's', east: 'e', west: 'w', up: 'up', down: 'down', n: 'n', s: 's', e: 'e', w: 'w' };
    if (lower.startsWith('go ') || lower.startsWith('move ') || lower.startsWith('walk ')) {
        const word = lower.split(/\s+/)[1];
        const dir = dirMap[word] || word;
        return JSON.stringify({ action: 'move', direction: dir });
    }
    if (dirMap[lower]) {
        return JSON.stringify({ action: 'move', direction: dirMap[lower] });
    }

    // Look
    if (lower === 'look' || lower === 'l' || lower.startsWith('look around') || lower.startsWith('examine room')) {
        return JSON.stringify({ action: 'look' });
    }

    // Attack
    if (lower.startsWith('attack ') || lower.startsWith('hit ') || lower.startsWith('fight ') || lower.startsWith('kill ')) {
        const target = lower.replace(/^(attack|hit|fight|kill)\s+/i, '').trim();
        return JSON.stringify({ action: 'attack', target });
    }

    // Pickup
    if (lower.startsWith('pickup ') || lower.startsWith('pick up ') || lower.startsWith('take ') || lower.startsWith('grab ')) {
        const target = lower.replace(/^(pickup|pick up|take|grab)\s+/i, '').trim();
        return JSON.stringify({ action: 'pickup', target });
    }

    // Use
    if (lower.startsWith('use ') || lower.startsWith('drink ') || lower.startsWith('eat ')) {
        const target = lower.replace(/^(use|drink|eat)\s+/i, '').trim();
        return JSON.stringify({ action: 'use', target });
    }

    // Equip
    if (lower.startsWith('equip ') || lower.startsWith('wear ') || lower.startsWith('wield ')) {
        const target = lower.replace(/^(equip|wear|wield)\s+/i, '').trim();
        return JSON.stringify({ action: 'equip', target });
    }

    // Inventory
    if (lower === 'inventory' || lower === 'inv' || lower === 'i' || lower === 'bag') {
        return JSON.stringify({ action: 'inventory' });
    }

    // Stats
    if (lower === 'stats' || lower === 'status' || lower === 'character') {
        return JSON.stringify({ action: 'stats' });
    }

    // Open
    if (lower.startsWith('open ')) {
        const target = lower.replace(/^open\s+/i, '').trim();
        return JSON.stringify({ action: 'open', target });
    }

    // Talk
    if (lower.startsWith('talk ') || lower.startsWith('speak ') || lower.startsWith('chat ')) {
        const target = lower.replace(/^(talk|speak|chat)\s+(to|with)?\s*/i, '').trim();
        return JSON.stringify({ action: 'talk', target });
    }

    // Allocate
    if (lower.startsWith('allocate ') || lower.startsWith('level ')) {
        const stat = lower.replace(/^(allocate|level)\s+/i, '').trim();
        return JSON.stringify({ action: 'allocate', target: stat });
    }

    // Default
    return JSON.stringify({ action: 'look' });
}

module.exports = { callLLM };

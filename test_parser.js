// Quick test for parseThreadList logic
const Q = '"';

// Simulated Show Thread responses
const text1 = `<DATA>GPL_Code, Paused</DATA>\n<STATUS>0,${Q}Success${Q}</STATUS>`;
const text2 = `<DATA>GPL_Code, Paused</DATA><STATUS>0,${Q}Success${Q}</STATUS>`;
const text3 = `<DATA>\nGPL_Code, Paused\n</DATA>\n<STATUS>0,${Q}Success${Q}</STATUS>`;

function parseThreadList(text) {
    const threads = [];
    const cleaned = text.replace(/<\/?[A-Za-z][^>]*>/g, '');
    const lines = cleaned.split(/\r?\n/);
    console.log('  cleaned:', JSON.stringify(cleaned));
    console.log('  lines:', JSON.stringify(lines));
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { console.log(`  SKIP empty: ${JSON.stringify(line)}`); continue; }
        if (/^[-=]+$/.test(trimmed)) { console.log(`  SKIP separator: ${trimmed}`); continue; }
        if (/Thread\s*Name/i.test(trimmed)) { console.log(`  SKIP header: ${trimmed}`); continue; }
        const statusLineRe = new RegExp('^-?\\d+\\s*,\\s*"[^"]*"\\s*$');
        if (statusLineRe.test(trimmed)) { console.log(`  SKIP status: ${trimmed}`); continue; }
        
        let parts = trimmed.split(/\s{2,}|\t+/);
        if (parts.length < 2 && trimmed.includes(',')) {
            parts = trimmed.split(/,\s*/);
        }
        console.log(`  PARSE "${trimmed}" → parts=${JSON.stringify(parts)} (${parts.length})`);
        if (parts.length >= 2) {
            threads.push({ name: parts[0].trim(), state: parts[1] ? parts[1].trim() : '' });
        }
    }
    return threads;
}

console.log('=== Test 1: With newlines ===');
console.log('Result:', JSON.stringify(parseThreadList(text1)));

console.log('\n=== Test 2: No newlines (inline) ===');
console.log('Result:', JSON.stringify(parseThreadList(text2)));

console.log('\n=== Test 3: DATA with newlines inside ===');
console.log('Result:', JSON.stringify(parseThreadList(text3)));

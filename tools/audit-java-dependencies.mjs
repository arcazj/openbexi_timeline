import { readFile, writeFile } from 'node:fs/promises';

// Generate this file with Maven dependency:list -DincludeScope=runtime
// -DoutputFile=target/runtime-dependencies.txt before invoking this script.
const input = process.argv[2] || 'target/runtime-dependencies.txt';
const coordinates = [...(await readFile(input, 'utf8')).matchAll(/^\s+([^:\s]+):([^:\s]+):jar:([^:\s]+):(compile|runtime)\b/gm)]
    .map(([, group, artifact, version]) => ({ package: { ecosystem: 'Maven', name: `${group}:${artifact}` }, version }));
if (!coordinates.length) throw new Error(`No runtime Maven dependencies found in ${input}`);

const response = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries: coordinates }),
    signal: AbortSignal.timeout(60_000)
});
if (!response.ok) throw new Error(`OSV dependency audit failed: HTTP ${response.status}`);
const { results } = await response.json();
if (!Array.isArray(results) || results.length !== coordinates.length) throw new Error('OSV returned an incomplete audit');
const findings = results.flatMap((result, index) => (result.vulns || []).map(vulnerability => ({
    package: coordinates[index].package.name,
    version: coordinates[index].version,
    advisory: vulnerability.id,
    url: `https://osv.dev/vulnerability/${encodeURIComponent(vulnerability.id)}`
})));
await writeFile('target/dependency-audit-osv.json', JSON.stringify({
    checkedAt: new Date().toISOString(), source: 'https://api.osv.dev', scope: 'Maven runtime',
    packages: coordinates.length, findings
}, null, 2) + '\n');
console.log(`OSV checked ${coordinates.length} Maven runtime dependencies: ${findings.length} known advisories.`);
for (const finding of findings) console.error(`${finding.package}@${finding.version}: ${finding.advisory} ${finding.url}`);
if (findings.length) process.exitCode = 1;

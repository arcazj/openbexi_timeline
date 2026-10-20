import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(process.argv[2] || '.');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const dist=path.join(root,'dist');
const patchEvidence=`docs/release-${version}-regressions.json`;
const evidencePath=await fs.access(path.join(root,patchEvidence)).then(()=>patchEvidence,()=> 'docs/design/2.9/regression-results.json');
const evidence=JSON.parse(await fs.readFile(path.join(root,evidencePath),'utf8'));
if(evidence.version!==version || evidence.status!=='passed') throw new Error('Passing regression evidence for this release version is required');
const publicPackages=new Set(['timeline_data_collector','filesources','timeline_json','default','earthquake','volcano','mqtt','loki']);
const names=['windows-x64-setup.exe','source.zip','source.tar.gz'].map(suffix=>`openbexi-timeline-${version}-${suffix}`);
for(const [from,to] of [
    ['docs/design/2.9/openbexi_timeline.json','openbexi_timeline.json'],
    ['docs/design/2.9/openbexi_timeline.png','openbexi_timeline.png'],
    ['docs/design/2.9/architecture-overview.png','architecture-overview.png'],
    [`docs/release-${version}.md`,`release-${version}.md`],
    [evidencePath,'regression-results.json']]) {
    await fs.copyFile(path.join(root,from),path.join(dist,to)); names.push(to);
}
const manifest=JSON.parse(await fs.readFile(path.join(dist,'collector/manifest.json'),'utf8'));
if(new Set(manifest.packages.map(item=>item.package)).size!==publicPackages.size) throw new Error('Incomplete collector build');
for(const item of manifest.packages) {
    if(!publicPackages.has(item.package) || path.basename(item.name)!==item.name) throw new Error('Nonpublic collector artifact');
    const bytes=await fs.readFile(path.join(dist,'collector',item.name));
    if(createHash('sha256').update(bytes).digest('hex')!==item.sha256) throw new Error('Collector artifact checksum mismatch');
    await fs.writeFile(path.join(dist,item.name),bytes); names.push(item.name);
}
const hashes=[];
for(const name of names) {
    const bytes=await fs.readFile(path.join(dist,name)); if(!bytes.length) throw new Error('Empty asset: '+name);
    const line=createHash('sha256').update(bytes).digest('hex')+'  '+name+'\n';
    hashes.push(line);await fs.writeFile(path.join(dist,name+'.sha256'),line);
}
await fs.writeFile(path.join(dist,'SHA256SUMS'),hashes.join(''));
await fs.writeFile(path.join(dist,'release-assets.json'),JSON.stringify({version,files:[...names.flatMap(name=>[name,name+'.sha256']),'SHA256SUMS']},null,2)+'\n');
console.log(`Prepared ${names.length} reviewed release assets and checksums.`);

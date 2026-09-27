import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {projectRoot} from './serve-demos.mjs';
import {readDemoCatalog} from './update-demo-readme.mjs';

const root=await fs.realpath(projectRoot);
const output=path.join(root,'dist','pages');
await fs.mkdir(output,{recursive:true});
if(await fs.realpath(output)!==output) throw new Error('Pages output must stay in dist/pages without symlinks.');
// Rebuild only this verified output directory; never copy the working tree wholesale.
await fs.rm(output,{recursive:true});
await fs.mkdir(output,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'release/public-files.json'),'utf8'));
const publicAssets=manifest.filter(file=>/^(?:css|icon|help|docs|schemas|swagger|json\/test-data|models\/demos|demos)\//.test(file)
    || /^src\/[^/]+\.js$/.test(file) || /^src\/vendor\/yaml\//.test(file)
    || ['demos.html','openbexi_timeline_model.html','openbexi_timeline_model_preview.html',
        'models/regular_timeline.json','models/regular_timeline_earthquake.json','README.md','LICENSE'].includes(file));
const dependencies=[
    'node_modules/three/build/three.module.min.js','node_modules/three/examples/jsm/controls/DragControls.js',
    'node_modules/three/LICENSE','node_modules/three-spritetext/dist/three-spritetext.mjs',
    'node_modules/three-spritetext/LICENSE','node_modules/simple-jscalendar/source/jsCalendar.min.js',
    'node_modules/simple-jscalendar/LICENSE'
];
for(const file of [...publicAssets,...dependencies]) {
    if(path.isAbsolute(file) || file.includes('\\') || file.split('/').some(part=>!part || part==='..' || part==='.'))
        throw new Error('Invalid Pages asset: '+file);
    const source=path.join(root,file),destination=path.join(output,file);
    if(await fs.realpath(source)!==source || !(await fs.lstat(source)).isFile()) throw new Error('Invalid Pages source: '+file);
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.copyFile(source,destination);
}
// Pages has no Java API. Keep its documented disabled actions without probing a nonexistent service.
const helpFile=path.join(output,'help/resources.json');
const help=JSON.parse(await fs.readFile(helpFile,'utf8'));
for(const section of help.sections) for(const link of section.links) delete link.probe;
await fs.writeFile(helpFile,JSON.stringify(help,null,2)+'\n');
const catalog=await readDemoCatalog();
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const links=catalog.demos.map(demo=>`<li><a href="demos.html?demo=${encodeURIComponent(demo.id)}">${escape(demo.title)}</a><p>${escape(demo.description)}</p></li>`).join('\n');
await fs.writeFile(path.join(output,'index.html'),`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenBEXI Timeline live demos</title><style>body{font:17px/1.5 system-ui,sans-serif;max-width:850px;margin:3rem auto;padding:0 1.2rem;color:#17283b;background:#f5f8fc}a{color:#1755a3}li{margin:1rem 0}p{margin:.3rem 0}footer{margin:2rem 0}</style></head>
<body><h1>OpenBEXI Timeline live demos</h1><p>Explore public datasets in Timeline, Table, Split and 3D views. Each demo runs directly in your browser.</p><ul>${links}</ul>
<footer><a href="docs/help-guide.html">User guide</a> · <a href="https://github.com/arcazj/openbexi_timeline">Source and documentation</a></footer></body></html>\n`);
await fs.writeFile(path.join(output,'.nojekyll'),'');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const commit=process.env.GITHUB_SHA || execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
await fs.writeFile(path.join(output,'version.json'),JSON.stringify({version,commit})+'\n');
console.log(`Built ${catalog.demos.length} demos and ${publicAssets.length+dependencies.length} public assets in dist/pages (${version}).`);

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=await fs.realpath(fileURLToPath(new URL('..',import.meta.url)));
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(pkg.version)) throw new Error('Invalid release version.');
const files=JSON.parse(await fs.readFile(path.join(root,'release/public-files.json'),'utf8'));
if(!Array.isArray(files) || new Set(files).size!==files.length) throw new Error('Invalid public-file manifest.');
const inside=(base,file)=>{const relative=path.relative(base,file);return relative!=='' && !relative.startsWith('..') && !path.isAbsolute(relative);};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const payload=[];
for(const file of files) {
    if(typeof file!=='string' || path.isAbsolute(file) || /[\x00-\x1f]/.test(file) || file.includes('\\') || file.split('/').some(p=>!p || p==='.' || p==='..') ||
        /(^|\/)(?:node_modules|target|out|\.git|\.idea|\.local-private|tomcat)(\/|$)/i.test(file) ||
        // The reviewed YAML parser ships its browser modules in a vendor dist
        // directory. Only those explicit JavaScript entries may use that name.
        (/(^|\/)dist(\/|$)/i.test(file) && !/^src\/vendor\/yaml\/dist\/(?:[a-z0-9_.-]+\/)*[a-z0-9_-]+\.js$/i.test(file)) ||
        /\.(?:iml|jks|p12|pfx|key|jar|class|log)$/i.test(file)) throw new Error('Disallowed public-file entry: '+file);
    const source=path.resolve(root,file),real=await fs.realpath(source),stat=await fs.lstat(source);
    if(!inside(root,real) || real!==source || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular public source file: '+file);
    const bytes=await fs.readFile(source);payload.push({file,bytes,sha256:sha256(bytes)});
}
// Documentation must not link to an unreviewed local screenshot outside the
// public manifest, even when the archive would otherwise omit that image.
const publicFiles=new Set(files);
for(const {file,bytes} of payload.filter(item=>/\.(md|html)$/i.test(item.file))) {
    const source=bytes.toString('utf8');
    const images=[...source.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|(\S+?))(?:\s+"[^"]*")?\s*\)/g)]
        .map(match=>match[1] || match[2]);
    images.push(...[...source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match=>match[1]));
    for(const reference of images) {
        if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue;
        const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(reference.split(/[?#]/)[0])));
        if(!publicFiles.has(target)) throw new Error('Documentation image is outside the public manifest: '+file+' -> '+reference);
    }
}
const dist=path.join(root,'dist');await fs.mkdir(dist,{recursive:true});
if(await fs.realpath(dist)!==dist) throw new Error('Release output must not be a symlink or junction.');
const stage=await fs.mkdtemp(path.join(dist,'.source-'));
const name='openbexi-timeline-'+pkg.version;
const bundle=path.join(stage,name);await fs.mkdir(bundle);
try {
    for(const {file,bytes} of payload) {
        const destination=path.join(bundle,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);
    }
    const manifest={version:pkg.version,license:pkg.license,
        licenseFile:'LICENSE',thirdPartyNotices:'docs/third-party-notices.md',
        priorLicenseFile:'docs/licenses/GPL-3.0-legacy.txt',
        files:payload.map(({file,bytes,sha256})=>({file,bytes:bytes.length,sha256}))};
    await fs.writeFile(path.join(bundle,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
    const archive=path.join(dist,name+'-source.tar.gz');
    execFileSync('tar',['--uid','0','--gid','0','--uname','root','--gname','root','-czf',archive,'-C',stage,name],{stdio:'inherit'});
    const checksum=sha256(await fs.readFile(archive));
    await fs.writeFile(archive+'.sha256',checksum+'  '+path.basename(archive)+'\n');
    await fs.writeFile(path.join(dist,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
    console.log(path.relative(root,archive)+' ('+payload.length+' public files)');
    console.log('SHA-256: '+checksum);
} finally {
    // Only remove this process's newly created staging directory, after checking
    // its real absolute path is inside the verified workspace output directory.
    const actual=await fs.realpath(stage);
    if(actual===stage && inside(dist,actual) && path.basename(actual).startsWith('.source-')) await fs.rm(actual,{recursive:true});
}

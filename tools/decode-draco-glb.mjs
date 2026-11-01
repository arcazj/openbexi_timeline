// Offline asset preparation only. Uses Three's existing bundled decoder so a
// reviewed museum model can be served without a runtime decoder or CDN request.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

export async function decodeDracoGLB(input) {
    if (input.toString('ascii', 0, 4) !== 'glTF' || input.readUInt32LE(4) !== 2 || input.readUInt32LE(8) !== input.length)
        throw new Error('Expected a complete glTF 2 binary.');
    const jsonLength = input.readUInt32LE(12), document = JSON.parse(input.toString('utf8', 20, 20 + jsonLength));
    const binaryHeader = 20 + jsonLength;
    if (input.readUInt32LE(binaryHeader + 4) !== 0x004e4942 || document.buffers.length !== 1 || document.buffers[0].uri)
        throw new Error('Only self-contained, single-buffer GLB assets are supported.');
    const binary = input.subarray(binaryHeader + 8, binaryHeader + 8 + input.readUInt32LE(binaryHeader));
    const module = {exports: {}};
    const filename = path.resolve(import.meta.dirname, '../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js');
    vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
        module, exports: module.exports, require: createRequire(import.meta.url),
        __dirname: path.dirname(filename), __filename: filename, process, console, Buffer, setTimeout, clearTimeout
    }, {filename});
    const draco = await module.exports({}), decoder = new draco.Decoder();
    const chunks = [binary]; let length = binary.length;
    const append = (data, target) => {
        const padding = (4 - length % 4) % 4;
        if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
        const index = document.bufferViews.length;
        document.bufferViews.push({buffer: 0, byteOffset: length, byteLength: data.byteLength, target});
        const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        chunks.push(bytes); length += bytes.length; return index;
    };
    let decoded = 0;
    try {
        for (const mesh of document.meshes || []) for (const primitive of mesh.primitives) {
            const extension = primitive.extensions?.KHR_draco_mesh_compression;
            if (!extension) continue;
            const view = document.bufferViews[extension.bufferView], compressed = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
            const buffer = new draco.DecoderBuffer(), geometry = new draco.Mesh();
            try {
                buffer.Init(new Int8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength), compressed.byteLength);
                const status = decoder.DecodeBufferToMesh(buffer, geometry);
                if (!status.ok() || !geometry.ptr) throw new Error('Draco decoding failed: ' + status.error_msg());
                for (const [semantic, id] of Object.entries(extension.attributes)) {
                    const accessor = document.accessors[primitive.attributes[semantic]];
                    if (accessor.componentType !== 5126 || accessor.normalized) throw new Error('Expected floating-point museum attributes.');
                    const attribute = decoder.GetAttributeByUniqueId(geometry, id), array = new draco.DracoFloat32Array();
                    try {
                        decoder.GetAttributeFloatForAllPoints(geometry, attribute, array);
                        const values = new Float32Array(array.size());
                        for (let i = 0; i < values.length; i++) values[i] = array.GetValue(i);
                        accessor.bufferView = append(values, 34962); accessor.byteOffset = 0; accessor.count = geometry.num_points();
                    } finally { draco.destroy(array); }
                }
                const faces = new draco.DracoInt32Array(), values = new Uint32Array(geometry.num_faces() * 3);
                try {
                    for (let face = 0; face < geometry.num_faces(); face++) {
                        decoder.GetFaceFromMesh(geometry, face, faces);
                        for (let i = 0; i < 3; i++) values[face * 3 + i] = faces.GetValue(i);
                    }
                } finally { draco.destroy(faces); }
                const accessor = document.accessors[primitive.indices];
                Object.assign(accessor, {bufferView: append(values, 34963), byteOffset: 0, count: values.length, componentType: 5125});
                delete primitive.extensions.KHR_draco_mesh_compression;
                if (!Object.keys(primitive.extensions).length) delete primitive.extensions;
                decoded++;
            } finally { draco.destroy(geometry); draco.destroy(buffer); }
        }
    } finally { draco.destroy(decoder); }
    if (!decoded) throw new Error('No Draco-compressed triangle mesh was found.');
    for (const key of ['extensionsUsed', 'extensionsRequired']) {
        document[key] = (document[key] || []).filter(name => name !== 'KHR_draco_mesh_compression');
        if (!document[key].length) delete document[key];
    }
    document.buffers[0].byteLength = length;
    const json = Buffer.from(JSON.stringify(document)), jsonPadding = (4 - json.length % 4) % 4, binPadding = (4 - length % 4) % 4;
    const jsonHeader = Buffer.alloc(20), binHeader = Buffer.alloc(8);
    jsonHeader.write('glTF'); jsonHeader.writeUInt32LE(2, 4);
    jsonHeader.writeUInt32LE(20 + json.length + jsonPadding + 8 + length + binPadding, 8);
    jsonHeader.writeUInt32LE(json.length + jsonPadding, 12); jsonHeader.writeUInt32LE(0x4e4f534a, 16);
    binHeader.writeUInt32LE(length + binPadding); binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([jsonHeader, json, Buffer.alloc(jsonPadding, 32), binHeader, ...chunks, Buffer.alloc(binPadding)]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('Usage: node tools/decode-draco-glb.mjs INPUT.glb OUTPUT.glb');
    const bytes = await decodeDracoGLB(await fs.readFile(input));
    await fs.writeFile(output, bytes);
    console.log(`Wrote standard GLB: ${bytes.length} bytes.`);
}

import sharp from 'sharp';import {readdir,mkdir,rename} from 'node:fs/promises';
const directory='public/assets/magnific';await mkdir('artifacts/magnific/originals',{recursive:true});
for(const name of await readdir(directory))if(/\.(png|jpg)$/.test(name)){
 const target=name.replace(/\.(png|jpg)$/,'.webp');await sharp(`${directory}/${name}`).resize(512,512,{fit:'inside'}).webp({quality:name.includes('normal')?92:80}).toFile(`${directory}/${target}`);
 await rename(`${directory}/${name}`,`artifacts/magnific/originals/${name}`);console.log(target);
}

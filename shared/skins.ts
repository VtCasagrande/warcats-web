import type { SkinId } from './types';
export const SKINS: Record<SkinId,{name:string;color:string;texture:string|null;description:string}> = {
 standard:{name:'De serviço',color:'#53614d',texture:null,description:'Acabamento original de fábrica.'},
 woodland:{name:'Bosque',color:'#526340',texture:'/assets/magnific/expansion/skins/woodland.webp',description:'Camuflagem orgânica em verde e terra.'},
 desert:{name:'Duna',color:'#b5a076',texture:'/assets/magnific/expansion/skins/desert.webp',description:'Areia, pedra e poeira do deserto.'},
 arctic:{name:'Geada',color:'#cbd2ce',texture:'/assets/magnific/expansion/skins/arctic.webp',description:'Branco quebrado com fragmentos cinza.'},
 urban:{name:'Concreto',color:'#6c7780',texture:'/assets/magnific/expansion/skins/urban.webp',description:'Geometria discreta para o setor urbano.'},
 carbon:{name:'Carbono',color:'#343d43',texture:'/assets/magnific/expansion/skins/carbon.webp',description:'Trama técnica de fibra de carbono.'},
 ember:{name:'Brasa',color:'#9b5138',texture:'/assets/magnific/expansion/skins/ember.webp',description:'Cobre queimado e grafite fosco.'},
 naval:{name:'Maré',color:'#365866',texture:'/assets/magnific/expansion/skins/naval.webp',description:'Azul naval e cinza de aço.'},
};
export const SKIN_IDS=Object.keys(SKINS) as SkinId[];
export const isSkin=(value:unknown):value is SkinId=>typeof value==='string' && Object.hasOwn(SKINS,value);

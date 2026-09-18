import type {MapDocument} from '../../shared/map-editor';
export class EditorHistory{
 private past:MapDocument[]=[];private future:MapDocument[]=[];
 push(doc:MapDocument){this.past.push(structuredClone(doc));if(this.past.length>60)this.past.shift();this.future=[];}
 undo(current:MapDocument){const previous=this.past.pop();if(!previous)return null;this.future.push(structuredClone(current));return previous;}
 redo(current:MapDocument){const next=this.future.pop();if(!next)return null;this.past.push(structuredClone(current));return next;}
 clear(){this.past=[];this.future=[];}
 get canUndo(){return this.past.length>0;}get canRedo(){return this.future.length>0;}
}

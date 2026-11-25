// Rendering-only policies. No server simulation or input parameters are changed.
export const defaults=Object.freeze({fps:90,quality:'high',resolution:80,dynamic:true,effects:true,lod:true});
export const profiles=Object.freeze({low:{pixelCap:.75,detailDistance:32},medium:{pixelCap:.9,detailDistance:46},high:{pixelCap:1,detailDistance:65},ultra:{pixelCap:1.5,detailDistance:100}});
export function normalizeSettings(s={}){
 const fps=Number(s.fps),resolution=Number(s.resolution);
 return {fps:[0,30,60,90,120].includes(fps)&&s.fps!=null?fps:defaults.fps,quality:Object.hasOwn(profiles,s.quality)?s.quality:defaults.quality,resolution:Number.isFinite(resolution)&&s.resolution!=null?Math.min(100,Math.max(50,Math.round(resolution/5)*5)):defaults.resolution,dynamic:typeof s.dynamic==='boolean'?s.dynamic:defaults.dynamic,effects:typeof s.effects==='boolean'?s.effects:defaults.effects,lod:typeof s.lod==='boolean'?s.lod:defaults.lod};
}
export function pixelRatio(settings,dpr,scale=settings.resolution/100){return Math.min(Math.max(.5,dpr),profiles[settings.quality].pixelCap)*scale;}
export function adaptiveScale(scale,settings,fps,refresh){const max=settings.resolution/100,min=Math.min(max,.5);if(!settings.dynamic)return max;const target=Math.min(settings.fps||refresh,refresh);if(fps<target*.88)return Math.max(min,scale-.05);if(fps>=target*.97)return Math.min(max,scale+.025);return scale;}
export class FrameGate{
 constructor(){this.last=null;this.carry=0;}
 reset(){this.last=null;this.carry=0;}
 due(now,fps){if(this.last===null){this.last=now;return true;}const delta=Math.max(0,now-this.last);this.last=now;if(!fps){this.carry=0;return true;}const period=1000/fps;this.carry+=Math.min(delta,250);if(this.carry+0.3<period)return false;this.carry=Math.max(0,this.carry-period)%period;return true;}
}
// Bounded reusable objects. Release returns false when the object was discarded.
export class Pool{
 constructor(create,reset=()=>{},dispose=()=>{},limit=128){Object.assign(this,{create,reset,dispose,limit,free:[]});}
 acquire(){return this.free.pop()||this.create();}
 release(v){this.reset(v);if(this.free.length>=this.limit){this.dispose(v);return false;}this.free.push(v);return true;}
 clear(){for(const v of this.free)this.dispose(v);this.free.length=0;}
}
export function pushSample(samples,t,x,z,angle=0){const last=samples.at(-1);if(last&&(t<=last.t||Math.hypot(x-last.x,z-last.z)>16))samples.length=0;samples.push({t,x,z,angle});while(samples.length>8)samples.shift();}
export function sampleAt(samples,t,out={}){if(!samples.length)return null;let a=samples[0],b=a;for(let i=1;i<samples.length;i++){b=samples[i];if(t<=b.t)break;a=b;}const f=b.t===a.t?0:Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));out.x=a.x+(b.x-a.x)*f;out.z=a.z+(b.z-a.z)*f;out.angle=a.angle+Math.atan2(Math.sin(b.angle-a.angle),Math.cos(b.angle-a.angle))*f;return out;}

(function(root){
  function flameOffset(nx,ny,aspect){
    const len=Math.max(1,Math.hypot(nx,ny));nx/=len;ny/=len;
    aspect=Math.max(.35,Math.min(3.5,aspect));
    const L=Math.hypot(29,26),t=Math.tan(55*Math.PI/360);
    // Normal camera: position (0,30,26), look at (0,1,0).
    // Ground under player is slightly below the optical centre.
    const base=-26/1546/t;
    const vy=(ny+base)*t;
    const rayY=(-29+26*vy)/L,rayZ=(-26-29*vy)/L;
    const k=30/-rayY;
    return {x:k*nx*t*aspect,z:26+k*rayZ};
  }
  const FIRE_SIZE=10;
  const dashDistance=mode=>2*.6*(mode==='duel'?9:15);
  const shieldFrontReduction=(helmet=0,armor=0)=>Math.min(.92,.8+.02*(helmet+armor));
  const api={flameOffset,FIRE_SIZE,dashDistance,shieldFrontReduction};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SkillGeometry=api;
})(globalThis);

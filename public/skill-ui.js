export const cooldowns=Object.freeze({flame:25,phase:22,shield:12,twin:35,sage:30,vampire:30,blackhole:25});
export function createCooldown(clock=()=>performance.now()){
 let until=0, duration=0;
 return {reset(){until=0;duration=0},activate(role){if(!cooldowns[role]||clock()<until)return false;duration=cooldowns[role]*1000;until=clock()+duration;return true},read(){const remaining=Math.max(0,until-clock());return {remaining,ratio:duration?remaining/duration:0}}};
}

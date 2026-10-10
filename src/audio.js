// Original procedural ambience. No third-party recordings are required.
export class Soundscape {
  constructor(){this.ctx=null;this.enabled=false;this.musicVolume=.22;this.ambienceVolume=.35;this.nextNote=0;this.nextBird=0;}
  async enable(){
    if(!this.ctx){
      this.ctx=new AudioContext();this.master=this.ctx.createGain();this.master.gain.value=.6;this.master.connect(this.ctx.destination);
      this.music=this.ctx.createGain();this.music.connect(this.master);
      const buffer=this.ctx.createBuffer(1,this.ctx.sampleRate*4,this.ctx.sampleRate),data=buffer.getChannelData(0);let last=0;
      for(let i=0;i<data.length;i++){last=(last+(Math.random()*2-1)*.018)/1.018;data[i]=last*3;}
      this.noise=this.ctx.createBufferSource();this.noise.buffer=buffer;this.noise.loop=true;this.filter=this.ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=850;this.noiseGain=this.ctx.createGain();this.noiseGain.gain.value=0;this.noise.connect(this.filter);this.filter.connect(this.noiseGain);this.noiseGain.connect(this.master);this.noise.start();
    }
    await this.ctx.resume();this.enabled=!this.enabled;this.master.gain.setTargetAtTime(this.enabled?.65:0,this.ctx.currentTime,.5);return this.enabled;
  }
  note(freq,duration=4,volume=.05){
    if(!this.ctx||!this.enabled)return;const t=this.ctx.currentTime,osc=this.ctx.createOscillator(),gain=this.ctx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(volume,t+.15);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);osc.connect(gain);gain.connect(this.music);osc.start(t);osc.stop(t+duration+.1);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  click(){this.note(523.25,.2,.06);}
  update(environment,focus){
    if(!this.ctx||!this.enabled)return;const t=this.ctx.currentTime;
    this.music.gain.setTargetAtTime(this.musicVolume,t,.4);
    const rain=environment.weather==='rain',river=Math.max(0,1-Math.abs(focus.x)/80);this.noiseGain.gain.setTargetAtTime(this.ambienceVolume*(rain?.75:.07+river*.15),t,1.2);this.filter.frequency.setTargetAtTime(rain?4200:700,t,1);
    if(t>this.nextNote){const progression=[196,246.94,293.66,369.99,392,493.88];this.note(progression[Math.floor(t/4)%progression.length],7,.065);this.nextNote=t+3.2;}
  }
}

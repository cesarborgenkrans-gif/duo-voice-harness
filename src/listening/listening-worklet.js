// Fixed-duration PCM capture; flush acknowledged before releasing input tracks.
class ListeningCapture extends AudioWorkletProcessor{
  constructor(){super();this.buffer=new Float32Array(Math.ceil(sampleRate*10));this.used=0;this.levelFrames=0;this.levelSquares=0;this.port.onmessage=e=>{if(e.data?.frames)this.frames=true;if(e.data==='flush'){this.send();this.port.postMessage({flushed:true});}};}
  send(){if(this.used){const samples=this.buffer.slice(0,this.used);this.used=0;this.port.postMessage({samples},[samples.buffer]);}}
  process(inputs,outputs){for(const channel of outputs[0]||[])channel.fill(0);const input=inputs[0];if(!input?.[0])return true;for(let i=0;i<input[0].length;i++){let value=0;for(const channel of input)value+=channel[i]||0;value/=input.length;this.buffer[this.used++]=value;this.levelSquares+=value*value;if(++this.levelFrames>=Math.round(sampleRate*(this.frames?.01:.04))){this.port.postMessage({level:Math.sqrt(this.levelSquares/this.levelFrames)});this.levelFrames=this.levelSquares=0;if(this.frames)this.send();}if(this.used===this.buffer.length)this.send();}return true;}
}
registerProcessor('listening-capture',ListeningCapture);


function Synth() {
  let audio = new AudioContext();
  //let envelope = new ADSREnvelope(0.2,0.06,0.8,0.7)
  let envelope = new ADSREnvelope(0.01,0.06,0.6,0.4);
//  let instr = new PatchFactory(envelope, 'sine', [10,3,5,2,1,0.4,0.1]);
  let instr = new PatchFactory(envelope, 'triangle', [10,7,1,4,8,1,0.1,0.8]);
//  let instr = new PatchFactory(envelope, 'sine', [1]);
  let channel = new Channel(instr,[new Flanger('sine', 0.20, 0.007, 0.5, 0.2)]);
//  let channel = new Channel(instr);
  let queue = new TimedEventQueue();
  let timeStep = 0.05;

  setInterval(playFromQueue, timeStep*1000);

  let sources = {
    ModuloPolynomial : ModuloPolynomial,
    Collatz : CollatzGenerator,
    ModuloFibonacci : FibonacciGenerator
  }

  //ModuloPoly: {mod:253,coeffs:[1,3,0,1], length:1000, iterate:true}
  //Collatz: {seed:1793}
  //Fibonacci: {mod:10, length:1000}
  this.play = function(source, params) {
    console.log("Playing ",source,params);
    let scale = createScale(params.scale_type, params.scale_shift);
    let time = audio.currentTime+timeStep*2;
    let range = params.range;
    let sourceConstructor = sources[source];
    let notes = new (sourceConstructor.bind.apply(sourceConstructor, arguments));
    for (let n = notes.next(); !n.done; n = notes.next()) {
        queue.enqueue(time, scale.note(n.value % range));
        time += 0.25;
    }
  }

  function playFromQueue() {
    let endTime = audio.currentTime + timeStep*1.2;
    for (let note = queue.dequeue(endTime); !!note ; note = queue.dequeue(endTime)) {
//      channel.play(note.time, note.event,5,{vibrato_freq: 0.3,vibrato_depth:100});
      channel.play(note.time, note.event,1);
    }
  }

  this.stop = function() {
    console.log("Stopping.");
    queue.clear();
  }

  function TimedEventQueue() {
    let queue = [];

    this.enqueue = function(time,event) {
      queue.push({time:time,event:event}); //TODO: find insertion point
    }

    this.dequeue = function(before) {
      if (queue.length > 0 && queue[0].time < before)
        return queue.shift();
      return null;
    }

    this.clear = function() {
      queue.length = 0;
    }
  }

  function ModuloPolynomial(params) {
    let mod = params.mod;
    let coeffs = Array.isArray(params.coeffs) ? params.coeffs : params.coeffs.split(",").map(c => ~~c);
    let left = params.length;
    let iterate = !!params.iterate;

    console.log("ModuloPolynomial: ",mod,coeffs,left,iterate);

    let current = 0;

    function eval(x) {
      let ret = 0;
      for (c of coeffs) {
        ret *= x;
        ret += c;
      }
      return ret;
    }

    this.next = function() {
      let ret = eval(current);
      ret = ret - mod*Math.floor(ret/mod);
      if (iterate) {
        current = ret;
      } else {
        current++;
      }
      return {
        value : ret,
        done : left-- <= 0
      }
    }

  }

  function CollatzGenerator(params) {
    console.log("Collatz: ", this, params);
    let num = params.start;

    this.next = function() {
      num = num % 2 == 0 ? num/2 : (3*num+1)/2;
      return {
        value : num,
        done : num == 1
      };
    }
  }

  function FibonacciGenerator(params) {
    let previous = 1;
    let last = 1;
    let left = params.length;

    this.next = function() {
      let ret = (last + previous) % params.mod;
      previous = last;
      last = ret;
      return {
        value : ret,
        done : left-- <= 0
      }
    }
  }

  function createScale(type,shift) {
    const PENTATONIC = [2,2,3,2,3];
    const MAJOR = [2,2,1,2,2,2,1];

    let deltas = Array.from(type == "MAJOR" ? MAJOR : PENTATONIC);
    let len = deltas.length;
    deltas = deltas.concat(deltas).slice(shift,shift+len);
    let scale = [0];
    for (let i = 0; i < len - 1;i++) {
      scale.push(scale[i]+deltas[i]);
    }

    return new Scale(scale);

    function Scale(scale) {
      let A = 440;
      console.log("Scale: ",scale);

      this.note = function(key) {
        let octave = Math.floor(key/scale.length);
        let n = key - octave * scale.length;
        return Math.pow(2,octave+scale[n]/12)*A;
      }
    }
  }


  function PatchFactory(envelope,waveform,harmonics) {
    let sum = 0;
    harmonics.forEach(h => sum += h);
    let coeffs = harmonics.map(h => h/sum);
    console.log("PatchFactory: "+harmonics,coeffs);

    this.create = function() {
        let master = audio.createGain();
        master.gain.value = 1;
        let frequency_source = audio.createConstantSource();

        let oscillators = coeffs.map((c,i) => {
          let oscillator = audio.createOscillator();
          let gain = audio.createGain();
          let frequency_gain = audio.createGain();
          frequency_gain.gain.value = i+1;
          gain.gain.value = c;
          oscillator.type = waveform;
          oscillator.frequency.value = 0;

          frequency_source.connect(frequency_gain);
          frequency_gain.connect(oscillator.frequency);
          oscillator.connect(gain);
          gain.connect(master);
          return oscillator;
        });

        return {
          frequency : frequency_source.offset,
          volume : master.gain,
          connect : master.connect.bind(master),
          start : function(when) {frequency_source.start(when); oscillators.forEach(o => o.start(when));},
          stop : function(when) {frequency_source.stop(when); oscillators.forEach(o => o.stop(when));},
          envelope : envelope
        }
    }
  }

  function Flanger(shape, freq, depth, dry_ratio, feedback_ratio) {
    this.apply = function() {
        let output = audio.createGain();
        let dry = audio.createGain();
        let wet = audio.createGain();
        let modulator = audio.createOscillator();
        let mod_gain = audio.createGain();
        let delay = audio.createDelay();
        let input_gain = audio.createGain();
        let feedback = audio.createGain();
        delay.delayTime.value = depth*2;
        dry.gain.value = dry_ratio;
        wet.gain.value = 1 - dry_ratio;
        output.gain.value = 1;
        feedback.gain.value = feedback_ratio;
        input_gain.gain.value = 1 - feedback_ratio;
        modulator.frequency.value = freq;
        mod_gain.gain.value = depth;

        dry.connect(output);
        input_gain.connect(delay);
        delay.connect(wet);
        wet.connect(output);
        wet.connect(feedback);
        feedback.connect(delay);

        modulator.connect(mod_gain);
        mod_gain.connect(delay.delayTime);

        modulator.start();
        return {
          attachInput: function(input) {input.connect(dry); input.connect(input_gain);},
          output: output
        }
    }
  }

  function Channel(patch, effects) {
    let output = {
      attachInput : function(input) {input.connect(audio.destination);},
      output : null
    }
    if (effects) {
      if (!Array.isArray(effects)) {
        effects = [effects];
      }
      for (let effect of effects) {
        let e = effect.apply();
        output.attachInput(e.output);
        output = e;
      }
    }

    this.play = function(start,freq,len,options) {
      let note = patch.create();
      let master = audio.createGain();
      note.connect(master);
      output.attachInput(master);
      note.frequency.setValueAtTime(freq,start);
      note.start(start);
      let vibrato_osc = audio.createOscillator();
      if (!!options && !!options.vibrato_depth && !!options.vibrato_freq) {
        let vibrato_gain = audio.createGain();
        vibrato_osc.connect(vibrato_gain);
        vibrato_gain.connect(note.frequency);
        vibrato_osc.frequency = options.vibrato_freq;
        vibrato_osc.type = 'sine';
        vibrato_gain.gain.value = options.vibrato_depth;
        vibrato_osc.start(start);
      }
      let end = note.envelope.play(master.gain, start, len);
      note.stop(end);
      vibrato_osc.stop(end);
    }
  }

  function ADSREnvelope(a,d,s,r) {
    this.play = function(param,start,suslength) {
      param.setValueAtTime(0.0001, start) // start from 0
           .exponentialRampToValueAtTime(1,start+a) //attack
           .exponentialRampToValueAtTime(s,start+a+d) //delay
           .exponentialRampToValueAtTime(0.0001,start+a+d+suslength+r); //release
           return start+a+d+suslength+r;
    }
  }
}


function Synth() {
  let audio = new AudioContext();
  let scale = new Scale();
  //let envelope = new ADSREnvelope(0.2,0.06,0.8,0.7)
  let envelope = new ADSREnvelope(0.01,0.06,0.6,0.4);
//  let instr = new PatchFactory(envelope, 'sine', [10,3,5,2,1,0.4,0.1]);
  let instr = new PatchFactory(envelope, 'triangle', [10,7,1,4,8,1,0.1,0.8]);
  let channel = new Channel(instr,[new Flanger('sine', 0.20, 0.007, 0.5, 0.2)]);
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
    let time = audio.currentTime+timeStep*2;
    let range = 10;
    let sourceConstructor = sources[source];
    let notes = new (sourceConstructor.bind.apply(sourceConstructor, arguments));
    for (let n = notes.next(); !n.done; n = notes.next()) {
        queue.enqueue(time, n.value % range);
        time += 0.25;
    }
  }

  function playFromQueue() {
    let endTime = audio.currentTime + timeStep*1.2;
    for (let note = queue.dequeue(endTime); !!note ; note = queue.dequeue(endTime)) {
      channel.play(note.time, scale.note(note.event), 1);
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
    let coeffs = Array.isArray(params.coeffs) ? params.coeffs : params.coeffs.split(",");
    let left = params.length;
    let iterate = !!params.iterate;

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


  function Scale() {
    let A = 440;
    //let scale = [0, 2, 4, 5, 7, 9, 11]; //bog standard major
    let scale = [0,3,5,7,10]; //minor pentatonic

    this.note = function(key) {
      let octave = Math.floor(key/scale.length);
      let n = key - octave * scale.length;
      return Math.pow(2,octave+scale[n]/12)*A;
    }
  }

  function PatchFactory(envelope,waveform,harmonics) {
    let sum = 0;
    harmonics.forEach(h => sum += h);
    let coeffs = harmonics.map(h => h/sum);
    console.log(harmonics,coeffs);


    this.create = function() {
        let master = audio.createGain();
        master.gain.value = 1;
        let oscillators = coeffs.map(c => {
          let o = audio.createOscillator();
          let gain = audio.createGain();
          gain.gain.value = c;
          o.type = waveform;
          o.connect(gain);
          gain.connect(master);
          return o;
        });

        return {
          freq : function(freq,time) {
            for (let i = 0; i < oscillators.length; i++) {
                oscillators[i].frequency.setValueAtTime(freq*(i+1), time);
            }
          },
          ramp : function(freq,time) {
            for (let i = 0; i < oscillators.length; i++) {
                oscillators[i].frequency.exponentialRampToValueAtTime(freq*(i+1), time);
            }
          },
          connect : master.connect.bind(master),
          start : function(when) {oscillators.forEach(o => o.start(when));},
          stop : function(when) {oscillators.forEach(o => o.stop(when));},
          envelope : envelope
        }
    }
  }

  function Vibrato(shape, freq, depth) {
    this.apply = function() {
      let gain = audio.createGain();
      let modulator = audio.createOscillator();
      modulator.type = shape;
      modulator.frequency.value = freq;
      gain.gain.value = depth;
      modulator.connect(gain);
      modulator.start();
      return {
        attachInput : function(input) {gain.connect(input.frequency);},
        output : gain
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

    this.play = function(start,freq,len) {
      let note = patch.create();
      let master = audio.createGain();
      note.connect(master);
      output.attachInput(master);
      note.freq(freq,start);
      note.start(start);
      let end = note.envelope.play(master.gain, start, len);
      note.stop(end);
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

export class HardSync {
  constructor(ctx) {
    this.ctx = ctx;
  }

  connect(masterOsc, slaveOsc) {
    masterOsc.onended = () => {
      try { slaveOsc.stop(); } catch(e) {}
    };
    return slaveOsc;
  }
}

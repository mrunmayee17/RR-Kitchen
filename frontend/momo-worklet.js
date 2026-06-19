// Capture worklet: posts mono Float32 microphone frames to the main thread,
// which resamples them to 16 kHz PCM16 for Gemini Live.
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      // Copy: the underlying buffer is reused by the audio thread.
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);

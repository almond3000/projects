import { useState } from "react";
import "./index.css";

export default function App() {
  const [weight, setWeight] = useState(1500);
  const [capacity, setCapacity] = useState(5000);
  const [voltage, setVoltage] = useState(14.8);
  const [efficiency, setEfficiency] = useState(7);

  const usableWh = ((capacity * voltage) / 1000) * 0.8;
  const powerWatts = efficiency > 0 ? weight / efficiency : 0;
  const minutes = powerWatts > 0 ? (usableWh / powerWatts) * 60 : 0;

  return (
    <div className="app">
      <h1>Flight Time Calculator</h1>

      <label>
        Drone weight (g)
        <input type="number" value={weight}
          onChange={(e) => setWeight(Number(e.target.value))} />
      </label>

      <label>
        Battery capacity (mAh)
        <input type="number" value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))} />
      </label>

      <label>
        Battery voltage (V)
        <input type="number" value={voltage}
          onChange={(e) => setVoltage(Number(e.target.value))} />
      </label>

      <label>
        Efficiency (g per watt)
        <input type="number" value={efficiency}
          onChange={(e) => setEfficiency(Number(e.target.value))} />
      </label>

      <div className="result">
        Estimated flight time: <strong>{minutes.toFixed(1)} minutes</strong>
      </div>
    </div>
  );
}

import { describe, expect, it } from "vitest";
import { TwoFingerGesture } from "./twoFingerGesture";
const finger = (identifier: number, clientX: number, clientY: number) => ({ identifier, clientX, clientY });
const pair = (dy=0, span=100, dx=0) => [finger(1,100+dx-span/2,200+dy),finger(2,100+dx+span/2,200+dy)];
describe("two-finger intent", () => {
  it.each([0,2,-3,7,-9])("parallel and diagonal translation tolerates %spx span jitter and stays ignored", jitter => {
    const g=new TwoFingerGesture(...pair() as [ReturnType<typeof finger>,ReturnType<typeof finger>]);
    expect(g.move(pair(3,100+jitter)).intent).toBe("pending");
    expect(g.move(pair(20,100+jitter,10))).toMatchObject({intent:"translation"});
    expect(g.move(pair(40,160,25))).toMatchObject({intent:"translation"});
  });
  it("clear pinch locks zoom even after centroid translation",()=>{const p=pair(),g=new TwoFingerGesture(p[0],p[1]);expect(g.move(pair(0,108)).intent).toBe("pending");expect(g.move(pair(0,125))).toMatchObject({intent:"pinch",ratio:1.25});expect(g.move(pair(50,130)).intent).toBe("pinch");});
  it("contact removal/replacement and cancellation remain consumed",()=>{for(const action of ['remove','replace','cancel']){const p=pair(),g=new TwoFingerGesture(p[0],p[1]);g.move(pair(20));if(action==='cancel')g.cancel();const points=action==='remove'?[p[0]]:action==='replace'?[p[0],finger(3,150,200)]:p;expect(g.move(points).intent).toBe('cancelled');expect(g.move(pair(30,160)).intent).toBe('cancelled');}});
});

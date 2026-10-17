import {expect, type Locator} from '@playwright/test';

/** Effective position in document SVG coordinates, including enclosing transforms. */
export async function penControlPosition(locator: Locator) {
  return locator.evaluate(node => {
    const element = node as SVGGraphicsElement;
    const root = element.ownerSVGElement;
    const screen = element.getScreenCTM(), view = root?.getScreenCTM();
    if (!screen || !view) throw new Error('Pen control has no displayed SVG transform.');
    let x: number, y: number;
    if (element instanceof SVGRectElement) {
      x = element.x.baseVal.value + element.width.baseVal.value / 2;
      y = element.y.baseVal.value + element.height.baseVal.value / 2;
    } else if (element instanceof SVGCircleElement) {
      x = element.cx.baseVal.value; y = element.cy.baseVal.value;
    } else throw new Error('Expected a displayed anchor or handle.');
    const point = new DOMPoint(x, y).matrixTransform(screen).matrixTransform(view.inverse());
    return {x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000};
  });
}

export async function expectPenControl(locator: Locator, x: number, y: number) {
  await expect(locator).toBeVisible();
  await expect.poll(() => penControlPosition(locator)).toEqual({x, y});
}

/**
 * Whether a page scroll is the learner reading back up while an answer
 * streams (TFEAT-08). The tutor itself only ever scrolls down, so an upward
 * move stops following, except when it is iOS rubber-banding past either end
 * (or settling back from past the end) or content above shrinking.
 */
export const isPageReadBack = ({ y, previousY, height, previousHeight, viewportHeight }) => {
  const end = height - viewportHeight;
  const bouncing = y < 0 || y > end + 1 || previousY > end + 1;
  return !bouncing && y < previousY - 2 && height >= previousHeight - 2;
};

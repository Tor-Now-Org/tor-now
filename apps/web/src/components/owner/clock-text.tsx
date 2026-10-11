/** A range as written in a sentence: hours, "09:00–13:00", or days, "15–17". */
const RANGE = /(\d{1,2}(?::\d{2})?–\d{1,2}(?::\d{2})?)/;

/**
 * Text with every range kept on one line, and read left to right. A range is
 * one fact, and a line ending at "09:00–" with "13:00" on the next reads as
 * two. And an en dash, unlike a hyphen, does not hold two numbers together in
 * a Hebrew line: "12:00–18:00" was drawn "18:00–12:00". The words are
 * unchanged — only where a line may break, and which way the range runs.
 */
export const WithClocks = ({ text }: { text: string }) => (
  <>
    {text.split(RANGE).map((part, index) =>
      RANGE.test(part) ? (
        <span key={index} className="nowrap" dir="ltr">
          {part}
        </span>
      ) : (
        part
      ),
    )}
  </>
);

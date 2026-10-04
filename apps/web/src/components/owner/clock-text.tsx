/** An hour range as written in a sentence: "09:00–13:00". */
const RANGE = /(\d{2}:\d{2}–\d{2}:\d{2})/;

/**
 * Text with every hour range kept on one line. A range is one fact, and a line
 * ending at "09:00–" with "13:00" on the next reads as two. The words are
 * unchanged — only where a line may break is.
 */
export const WithClocks = ({ text }: { text: string }) => (
  <>
    {text.split(RANGE).map((part, index) =>
      RANGE.test(part) ? (
        <span key={index} className="nowrap">
          {part}
        </span>
      ) : (
        part
      ),
    )}
  </>
);

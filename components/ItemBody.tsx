type ItemBodyProps = {
  html: string;
};

export default function ItemBody({ html }: ItemBodyProps) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

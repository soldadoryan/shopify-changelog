import Link from "next/link";
import Icon, { type IconName } from "./Icon";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  icon?: IconName;
  headingLevel?: 1 | 2;
};

export default function EmptyState({ title, description, action, icon = "inbox", headingLevel = 1 }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="panel empty">
      <Icon name={icon} className="empty__icon" />
      <Heading className="empty__title">{title}</Heading>
      {description ? <p>{description}</p> : null}
      {action ? (
        <Link href={action.href} className="button button--primary">
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}

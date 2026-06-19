import { useParams } from 'react-router'

export default function BlogPostPage() {
  const { slug } = useParams()
  return <h1 data-testid="slug">{slug}</h1>
}

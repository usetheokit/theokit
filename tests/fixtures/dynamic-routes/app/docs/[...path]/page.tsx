import { useParams } from 'react-router'

export default function DocsCatchAllPage() {
  const params = useParams()
  return <h1 data-testid="catchall">{params['*']}</h1>
}

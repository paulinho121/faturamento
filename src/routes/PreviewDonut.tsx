import { FilialDonut } from '../components/charts/FilialDonut'

// Temporary DEV-only harness to verify the donut tooltip with long filial names.
export function PreviewDonut() {
  const data = [
    { filial_id: '1', filial_nome: 'Multi Comercial Importadora SP', faturamento: 56440.12 },
    { filial_id: '2', filial_nome: 'Multi Comercial Importadora Matriz', faturamento: 7370.22 },
  ]
  return (
    <div className="min-h-screen bg-background p-lg">
      <div className="grid grid-cols-1 gap-lg lg:grid-cols-12">
        <FilialDonut data={data} loading={false} />
      </div>
    </div>
  )
}

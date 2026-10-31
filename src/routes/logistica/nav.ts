// badge: entregas faturadas esperando a logística despachar.
export const logisticaNavItems = (aguardando = 0) => [
  { to: '/logistica/entregas', icon: 'package_2', label: 'Entregas', badge: aguardando },
  { to: '/logistica', icon: 'local_shipping', label: 'Transferências' },
]

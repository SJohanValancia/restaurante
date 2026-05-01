        async function imprimirFacturaPOS() {
            if (!pedidoParaImprimir) {
                // Si no hay datos cargados, intentar cargarlos ahora
                if (currentOrderIdForPayment) {
                    await obtenerDatosPedidoParaImprimir(currentOrderIdForPayment);
                }
                
                if (!pedidoParaImprimir) {
                    Swal.fire('Error', 'No hay datos del pedido para imprimir', 'error');
                    return;
                }
            }

            const btn = document.querySelector('.btn-primary[onclick*="imprimirFacturaPOS"]');
            if(btn) btn.disabled = true;

            mostrarEstadoImpresion('imprimiendo');

            try {
                // Preparamos los datos del pedido para el Bridge
                const datosFactura = {
                    _id: pedidoParaImprimir._id,
                    mesa: pedidoParaImprimir.mesa,
                    items: pedidoParaImprimir.items,
                    total: pedidoParaImprimir.total,
                    restauranteNombre: currentUser.nombreRestaurante || "NÁPOLES GASTRO-BAR"
                };

                const response = await fetch('http://127.0.0.1:3001/print-factura', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datosFactura)
                });

                const data = await response.json();

                if (data.success) {
                    mostrarEstadoImpresion('exito');
                } else {
                    throw new Error(data.message);
                }
            } catch (error) {
                console.error('Error:', error);
                mostrarEstadoImpresion('error');
                Swal.fire('Error de Conector', 'No se pudo contactar con el Bridge. ¿Está abierto?', 'error');
            } finally {
                if(btn) btn.disabled = false;
            }
        }

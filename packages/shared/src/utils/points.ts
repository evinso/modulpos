import {
  POINTS_TO_CURRENCY_RATE,
  CASH_WITHDRAWAL_FEE_PERCENT,
  MINIMUM_REDEMPTION_POINTS,
} from '../types/points'

export function pointsToCurrency(points: number): number {
  return parseFloat((points * POINTS_TO_CURRENCY_RATE).toFixed(2))
}

export function currencyToPoints(amount: number): number {
  return Math.ceil(amount / POINTS_TO_CURRENCY_RATE)
}

export function calculateWithdrawalFee(amount: number): number {
  return parseFloat((amount * CASH_WITHDRAWAL_FEE_PERCENT).toFixed(2))
}

export function canRedeem(availablePoints: number): boolean {
  return availablePoints >= MINIMUM_REDEMPTION_POINTS
}

export function getActivationDate(pendingHours: number): Date {
  const date = new Date()
  date.setHours(date.getHours() + pendingHours)
  return date
}

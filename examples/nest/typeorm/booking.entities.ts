import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Tables for the example only (created by the test itself). No @ManyToOne/@OneToMany between
// them, on purpose: entities that import each other need ts-jest instead of SWC (see the kit's
// troubleshooting, "Cannot access ... before initialization").

@Entity('example_halls')
export class HallEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 100 })
  name!: string;

  @Column()
  capacity!: number;
}

@Entity('example_bookings')
export class BookingEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  hallId!: number;

  @Column({ type: 'date' })
  date!: string;

  @Column()
  guests!: number;

  @Column({ length: 200 })
  contactEmail!: string;

  @Column({ type: 'datetime', nullable: true })
  reminderSentAt!: Date | null;
}

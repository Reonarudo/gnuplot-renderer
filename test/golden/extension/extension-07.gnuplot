set datafile separator comma
set grid
plot "./data/results.csv" using 1:2 with linespoints title "Saved CSV data"